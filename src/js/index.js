/*jshint browser: true, jquery: true */
/*global clique, _, tangelo, d3, PEG */

$(function () {
    "use strict";

    var parser,
        removeAlert,
        createAlert,
        cfg;

    $("#add-clause").on("show.bs.modal", function () {
        var emptyQuery,
            secondary;

        // If the query string is currently empty, then remove the logical
        // connective from the UI.
        emptyQuery = _.size($("#query-string").val().trim()) === 0;
        d3.select("#clause-type")
            .style("display", emptyQuery ? "none" : null);

        // Query the database for all available field names, and construct an
        // autocomplete menu from them.
        $.getJSON("assets/tangelo/anb/get_fieldnames", {
            host: cfg.host,
            db: cfg.database,
            coll: cfg.collection
        }).then(function (fields) {
            $("#fieldname").autocomplete({
                source: fields,
                minLength: 0
            }).focus(function () {
                $(this).autocomplete("search", $(this).val());
            });
        });

        // This function extracts the field name from the appropriate place - it
        // winds up in different locations for different triggering events.
        secondary = _.debounce(function (evt, ui) {
            var field;

            if (ui) {
                field = ui.item.value;
            } else {
                field = $("#fieldname").val();
            }

            field = field.trim();
            if (field !== "") {
                // Pass the field name to the value service in order to get a
                // list of possible values.
                $.getJSON("assets/tangelo/anb/get_values", {
                    host: cfg.host,
                    db: cfg.database,
                    coll: cfg.collection,
                    field: field
                }).then(function (values) {
                    $("#value").autocomplete({
                        source: values,
                        minLength: 0
                    }).focus(function () {
                        var $this = $(this);

                        if ($this.data("ui-autocomplete")) {
                            $(this).autocomplete("search", $(this).val());
                        }
                    });
                });
            } else {
                $("#value").autocomplete("destroy");
            }
        }, 200);

        // Trigger the secondary autocomplete population on both manual typing
        // and selecting a choice from the primary autocomplete menu.
        $("#fieldname").on("input", secondary);
        $("#fieldname").on("autocompleteselect", secondary);
    });

    removeAlert = function (selector) {
        d3.select(selector)
            .selectAll(".alert.alert-danger")
            .remove();
    };

    createAlert = function (selector, message) {
        d3.select(selector)
            .append("div")
            .classed("alert", true)
            .classed("alert-danger", true)
            .classed("alert-dismissible", true)
            .classed("fade", true)
            .classed("in", true)
            .html("<a class=\"close\" data-dismiss=\"alert\">&times;</a>" + message);
    };

    $("#add").on("click", function () {
        var query = $("#query-string").val(),
            clause = $("#clause-type select").val(),
            field = $("#fieldname").val(),
            op = $("#operator").val(),
            value = $("#value").val();

        removeAlert("#errors");

        if (_.size(query.trim()) > 0 && clause === "Clause type") {
            createAlert("#errors", "You must specify a <strong>clause type</strong>!");
            return;
        }

        if (field === "") {
            createAlert("#errors", "You must specify a <strong>field name</strong>!");
            return;
        }

        if (op === "Operator") {
            createAlert("#errors", "You must specify an <strong>operator</strong>!");
            return;
        }

        switch (clause) {
        case "AND": {
            query += " & ";
            break;
        }

        case "OR": {
            query += " | ";
            break;
        }

        case "Clause type": {
            break;
        }

        default: {
            throw new Error("Impossible");
        }
        }

        query += [field, op, "\"" + value + "\""].join(" ");

        $("#query-string").val(query);
        $("#add-clause").modal("hide");
    });

    var launch = function (_cfg) {
        var graph,
            view,
            ungroup,
            info,
            linkInfo,
            colormap;

        cfg = _cfg;

        window.graph = graph = new clique.Graph({
            adapter: new tangelo.plugin.mongo.Mongo({
                host: cfg.host || "localhost",
                database: cfg.database,
                collection: cfg.collection
            })
        });

        $.getJSON("assets/tangelo/anb/get_filenames", {
            host: cfg.host,
            db: cfg.database,
            coll: cfg.collection
        }).then(function (filenames) {
            $("#filename").autocomplete({
                source: filenames,
                minLength: 0
            }).focus(function () {
                $(this).autocomplete("search", $(this).val());
            });
        });

        (function () {
            var request = null,
                action;

            action = _.debounce(function () {
                var filename = $("#filename").val();

                if (request) {
                    request.abort();
                }

                request = $.getJSON("assets/tangelo/anb/get_nodes", {
                    host: cfg.host,
                    db: cfg.database,
                    coll: cfg.collection,
                    filename: filename
                }).then(function (nodes) {
                    request = null;

                    $("#label").autocomplete({
                        source: nodes,
                        minLength: 0
                    }).focus(function () {
                        $(this).autocomplete("search", $(this).val());
                    });
                });
            }, 300);

            $("#filename").on("input", action);
            $("#filename").on("autocompleteselect", action);
        }());

        $("#submit").on("click", function () {
            var label = $("#label").val().trim(),
                filename = $("#filename").val().trim(),
                spec = {},
                delsearch = $("#delsearch").prop("checked");

            if (label === "" && filename === "") {
                return;
            }

            spec = {
                filename: filename,
                label: label
            };

            graph.adapter.findNode(spec)
                .then(function (center) {
                    if (center) {
                        graph.addNode(center);
                    }
                });
        });

        $("#submit-adv").on("click", function () {
            var query = $("#query-string").val().trim(),
                errMsg,
                spec;

            // Remove any existing syntax error alert.
            removeAlert("#syntaxerror");

            // Bail if there's no query.
            if (query === "") {
                return;
            }

            // Attempt to parse the string.
            try {
                spec = parser.parse(query);
            } catch (e) {
                errMsg = "line " + e.location.start.line + ", column " + e.location.start.column + ": " + e.message;
                createAlert("#syntaxerror", "<h4>Syntax error</h4> " + errMsg);
                return;
            }

            graph.adapter.findNodes(spec)
                .then(function (nodes) {
                    _.each(nodes, function (node) {
                        graph.addNode(node);
                    });
                });
        });

        colormap = d3.scale.category10();
        window.view = view = new clique.view.Cola({
            model: graph,
            el: "#content",
            label: function (d) {
                return d.data.label;
            },
            fill: function (d) {
                return colormap((d.data || {}).type || "no type");
            },
            nodeRadius: function (d, r) {
                return d.data && d.data.grouped ? 2*r : r;
            },
            postLinkAdd: function (s) {
                s.style("stroke-dasharray", function (d) {
                    return d.data && d.data.grouping ? "5,5" : "none";
                });
            },
            transitionTime: 500,
            focusColor: "pink",
            rootColor: "gold"
        });

        view.on("render", function () {
            var $cm,
                getMenuPosition;

            $cm = $("#contextmenu");

            // This returns a position near the mouse pointer, unless it is too
            // near the right or bottom edge of the window, in which case it
            // returns a position far enough inside the window to display the
            // menu in question.
            getMenuPosition = function (mouse, direction, scrollDir) {
                var win = $(window)[direction](),
                    scroll = $(window)[scrollDir](),
                    menu = $("#contextmenu")[direction](),
                    position = mouse + scroll;

                if (mouse + menu > win && menu < mouse) {
                    position -= menu;
                }

                return position;
            };

            // Attach a contextmenu action to all the nodes - it populates the
            // menu element with appropriate data, then shows it at the
            // appropriate position.
            d3.select(view.el)
                .selectAll("g.node")
                .on("contextmenu", function (d) {
                    var cm = d3.select("#contextmenu"),
                        ul = cm.select("ul"),
                        node = graph.adapter.getMutator(d.key),
                        left,
                        def,
                        top;

                    left = getMenuPosition(d3.event.clientX, "width", "scrollLeft");
                    top = getMenuPosition(d3.event.clientY, "height", "scrollTop");

                    cm.select("ul")
                        .select("li.nodelabel")
                        .text(d.data.label);

                    ul.select("a.context-hide")
                        .on("click", _.bind(clique.view.SelectionInfo.hideNode, info, node));

                    ul.select("a.context-ungroup")
                        .style("display", d.data.grouped ? null : "none")
                        .on("click", _.bind(ungroup, info, node));

                    ul.select("a.context-expand")
                        .on("click", _.bind(clique.view.SelectionInfo.expandNode, info, node));

                    ul.select("a.context-collapse")
                        .on("click", _.bind(clique.view.SelectionInfo.collapseNode, info, node));

                    if (cfg.intentService) {
                        def = $.getJSON(cfg.intentService, {
                            user: d.data.label
                        });
                    } else {
                        def = $.Deferred();
                        def.resolve({});
                    }

                    def.then(function (apps) {
                        apps = _.map(apps, function (data, app) {
                            return _.extend(data, {name: app});
                        });

                        cm.select("ul")
                            .selectAll("li.external")
                            .remove();

                        if (_.size(apps) > 0) {
                            cm.select("ul")
                                .append("li")
                                .classed("external", true)
                                .classed("dropdown-header", true)
                                .text("External Applications");

                            cm.select("ul")
                                .selectAll("li.external")
                                .data(apps)
                                .enter()
                                .append("li")
                                .classed("external", true)
                                .append("a")
                                .attr("tabindex", -1)
                                .attr("href", "#")
                                .text(function (d) {
                                    return d.name;
                                })
                                .on("click", function (d) {
                                    window.open(d.user, "_blank");

                                    $cm.hide();
                                });
                        }

                        $cm.show()
                            .css({
                                left: left,
                                top: top
                            });
                    });
                });

            // Clicking anywhere else will close any open context menu.  Use the
            // mouseup event (bound to only the left mouse button) to ensure the
            // menu disappears even on a selection event (which does not
            // generate a click event).
            d3.select(document.body)
                .on("mouseup.menuhide", function () {
                    if (d3.event.which !== 1) {
                        return;
                    }
                    $cm.hide();
                });
        });

        ungroup = function (node) {
            var fromLinks,
                toLinks,
                restoredNodes;

            // Get all links involving the group node.
            fromLinks = this.graph.adapter.findLinks({
                source: node.key()
            });

            toLinks = this.graph.adapter.findLinks({
                target: node.key()
            });

            $.when(fromLinks, toLinks).then(_.bind(function (from, to) {
                var inclusion,
                    reqs;

                // Find the "inclusion" links originating from the
                // group node.
                inclusion = _.filter(from, function (link) {
                    return link.getData("grouping");
                });

                // Store the node keys associated to these links.
                restoredNodes = _.invoke(inclusion, "target");

                // Delete all the links.
                reqs = _.map(from.concat(to), _.bind(this.graph.adapter.destroyLink, this.graph.adapter));

                return $.apply($, reqs);
            }, this)).then(_.bind(function () {
                // Remove the node from the graph.
                this.graph.removeNode(node);

                // Delete the node itself.
                return this.graph.adapter.destroyNode(node);
            }, this)).then(_.bind(function () {
                var reqs;

                // Get mutators for the restored nodes.
                reqs = _.map(restoredNodes, this.graph.adapter.findNodeByKey, this.graph.adapter);

                return $.when.apply($, reqs);
            }, this)).then(_.bind(function () {
                var nodes = _.toArray(arguments);

                // Clear the deleted flag from the nodes.
                _.each(nodes, function (node) {
                    node.clearData("deleted");
                }, this);

                // Add the nodes to the graph.
                this.graph.addNodes(nodes);
            }, this));
        };

        window.info = info = new clique.view.SelectionInfo({
            model: view.selection,
            el: "#info",
            graph: graph,
            nodeButtons: [
                {
                    label: "Hide",
                    color: "purple",
                    icon: "eye-close",
                    callback: function (node) {
                        _.bind(clique.view.SelectionInfo.hideNode, this)(node);
                    }
                },
                {
                    label: function (node) {
                        return node.getData("deleted") ? "Undelete" : "Delete";
                    },
                    color: "red",
                    icon: "remove",
                    callback: function (node) {
                        _.bind(clique.view.SelectionInfo.deleteNode, this)(node);
                    }
                },
                {
                    label: "Ungroup",
                    color: "blue",
                    icon: "scissors",
                    callback: ungroup,
                    show: function (node) {
                        return node.getData("grouped");
                    }
                },
                {
                    label: "Expand",
                    color: "blue",
                    icon: "fullscreen",
                    callback: function (node) {
                        _.bind(clique.view.SelectionInfo.expandNode, this)(node);
                    }
                },
                {
                    label: "Collapse",
                    color: "blue",
                    icon: "resize-small",
                    callback: function (node) {
                        _.bind(clique.view.SelectionInfo.collapseNode, this)(node);
                    }
                },
                {
                    label: "Centrality",
                    color: "blue",
                    icon: "screenshot",
                    show: _.isUndefined(cfg.nodeCentrality) ? true : cfg.nodeCentrality,
                    callback: function () {
                        var graph = this.graph,
                        subgraph = [];

                        // Convert graph connectivity into Clique format.
                        _.each(graph.get("nodes"), function (node) {
                            subgraph.push({
                                _id: {
                                    $oid: node.key
                                },
                                type: "node"
                            });
                        });

                        _.each(graph.get("links"), function (link) {
                            subgraph.push({
                                _id: {
                                    $oid: link.key
                                },
                                type: "link",
                                source: {
                                    $oid: link.source.key
                                },
                                target: {
                                    $oid: link.target.key
                                }
                            });
                        });

                        $.getJSON("assets/tangelo/romanesco/centrality", {
                            node: this.model.focused(),
                            graph: JSON.stringify(subgraph)
                        }).then(function (result) {
                            window.alert("Centrality: " + result);
                        });
                    }
                }
            ],
            selectionButtons: [
                {
                    label: "Hide",
                    color: "purple",
                    icon: "eye-close",
                    repeat: true,
                    callback: function (node) {
                        _.bind(clique.view.SelectionInfo.hideNode, this)(node);
                    }
                },
                {
                    label: "Delete",
                    color: "red",
                    icon: "remove",
                    repeat: true,
                    callback: function (node) {
                        return _.bind(clique.view.SelectionInfo.deleteNode, this)(node);
                    }
                },
                {
                    label: "Expand",
                    color: "blue",
                    icon: "fullscreen",
                    repeat: true,
                    callback: function (node) {
                        _.bind(clique.view.SelectionInfo.expandNode, this)(node);
                    }
                },
                {
                    label: "Collapse",
                    color: "blue",
                    icon: "resize-small",
                    repeat: true,
                    callback: function (node) {
                        _.bind(clique.view.SelectionInfo.collapseNode, this)(node);
                    }
                },
                {
                    label: "Group",
                    color: "blue",
                    icon: "paperclip",
                    callback: function (selection) {
                        var nodes,
                            links,
                            powerNode,
                            reqs;

                        // Extract keys from node selection.
                        nodes = _.map(selection, function (n) {
                            return n.key();
                        });
                        // nodes = _.invoke(selection, "key");

                        // Get all links going to or from nodes in the
                        // selection.
                        //
                        // Start by issuing ajax calls to look for links with
                        // each node as source and target.
                        reqs = _.flatten(_.map(nodes, _.bind(function (n) {
                            return [
                                this.graph.adapter.findLinks({
                                    source: n
                                }),
                                this.graph.adapter.findLinks({
                                    target: n
                                })
                            ];
                        }, this)));

                        // Issue a jquery when call to wait for all the requests
                        // to finish.
                        $.when.apply($, reqs).then(_.bind(function () {
                            // Collect the links from the function arguments,
                            // omitting the "shadow" halves of bidirectional
                            // links.
                            links = _.filter(Array.prototype.concat.apply([], _.toArray(arguments)), function (l) {
                                return !(l.getData("bidir") && l.getData("reference"));
                            });

                            // Create a new node that will serve as the power
                            // node.
                            return this.graph.adapter.createNode({
                                grouped: true
                            });
                        }, this)).then(_.bind(function (_powerNode) {
                            var inclusionReqs,
                                connectivityReqs,
                                reqs,
                                key;

                            powerNode = _powerNode;
                            key = powerNode.key();

                            // Create inclusion links for new power node.
                            inclusionReqs = _.map(nodes, _.bind(function (n) {
                                return this.graph.adapter.createLink(key, n, {
                                    grouping: true
                                });
                            }, this));

                            // Create connectivity links for new power node.
                            connectivityReqs = _.map(links, _.bind(function (link) {
                                var data = link.getAllData(),
                                    obj = {},
                                    source,
                                    target;

                                _.each(data, function (pair) {
                                    obj[pair[0]] = pair[1];
                                });

                                source = _.contains(nodes, link.source()) ? key : link.source();
                                target = _.contains(nodes, link.target()) ? key : link.target();

                                if (source !== key || target !== key) {
                                    return this.graph.adapter.createLink(source, target, obj);
                                }
                            }, this));

                            reqs = inclusionReqs.concat(_.compact(connectivityReqs));

                            return $.when.apply($, reqs);
                        }, this)).then(_.bind(function () {
                            var newLinks = _.toArray(arguments);

                            // Fill in any necessary "shadow" halves of
                            // bidirectional links.
                            return _.map(newLinks, _.bind(function (link) {
                                var reqs = [];

                                if (link.getData("bidir")) {
                                    reqs.push(this.graph.adapter.createLink(link.target(), link.source(), {
                                        bidir: true,
                                        reference: link.key()
                                    }));
                                }

                                return reqs;
                            }, this));
                        }, this)).then(_.bind(function () {
                            // Delete the original selection's nodes.
                            _.each(selection, clique.view.SelectionInfo.deleteNode, this);
                        }, this)).then(_.bind(function () {
                            // Add the new node to the graph.
                            this.graph.addNode(powerNode);
                        }, this));
                    }
                }
            ]
        });
        info.render();

        linkInfo = new clique.view.LinkInfo({
            model: view.linkSelection,
            el: "#link-info",
            graph: graph
        });
        linkInfo.render();

        if (cfg.titan && cfg.graphCentrality) {
            $("button.nodecentrality").on("click", function () {
                var rexster = window.location.origin + ["", "plugin", "mongo", "rexster", "graphs", cfg.database + "," + cfg.collection].join("/");

                $.getJSON("assets/tangelo/romanesco/degree_centrality/workflow", {
                    sourceGraph: rexster,
                    titan: cfg.titan
                }).then(function (result) {
                    console.log(result);
                });
            });
        } else {
            d3.selectAll(".nodecentrality")
                .remove();
        }

        $("#textmode").on("click", function () {
            view.toggleLabels();
        });

        $.get("assets/query.pegjs", "text").then(function (src) {
            parser = PEG.buildParser(src);
        }).then(function () {
            // If there are initialization parameters, pull in the requested
            // neighborhood.
            var args = tangelo.queryArguments(),
                radius = 1;

            if (_.size(args) > 0) {
                if (_.has(args, "radius")) {
                    radius = Number(args.radius);
                    delete args.radius;
                }

                graph.adapter.findNodes(args).then(function (nodes) {
                    _.each(nodes, function (node) {
                        graph.addNeighborhood({
                            center: node,
                            radius: radius
                        });
                    });
                });
            }
        });
    };

    $.getJSON("anb.json")
        .then(launch, _.bind(launch, {}));
});
