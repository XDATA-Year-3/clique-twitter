/*jshint browser: true, jquery: true */
/*global clique, _, tangelo, d3 */

$(function () {
    "use strict";

    var cfg,
        launch;

    launch = function (_cfg) {
        var mongoStore,
            graph,
            listSearch,
            view,
            info,
            linkInfo,
            colormap,
            linkColormap;

        cfg = _cfg;

        mongoStore = {
            host: cfg.host || "localhost",
            database: cfg.database,
            collection: cfg.collection
        };

        window.graph = graph = new clique.Graph({
            adapter: new tangelo.plugin.mongo.Mongo(mongoStore)
        });

        window.listSearch = listSearch = function (field, value) {
            return $.getJSON("assets/listsearch", _.extend({}, mongoStore, {
                field: field,
                value: value
            })).then(function (results) {
                var oids = _.pluck(_.pluck(results, "_id"), "$oid");
                return $.when.apply($, _.map(oids, graph.adapter.findNodeByKey, graph.adapter));
            }).then(function () {
                return _.toArray(arguments);
            });
        };

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
            var userid = $("#userid").val(),
                spec = {};

            if (userid === "") {
                return;
            }

            spec = {
                id: userid
            };

            graph.adapter.findNode(spec).then(function (center) {
                var next;

                if (_.isUndefined(center)) {
                    next = listSearch("usernames", userid);
                } else {
                    next = $.when([center]);
                }

                return next;
            }).then(function (results) {
                graph.addNodes(results);
            });
        });

        colormap = d3.scale.category10();

        // This is a 3-color categorical colormap from colorbrewer
        // (http://colorbrewer2.org/?type=qualitative&scheme=Paired&n=3) to
        // encode interaction types: mention, reply, and retweet.
        linkColormap = d3.scale.ordinal();
        linkColormap.range(["#a6cee3","#1f78b4","#b2df8a"]);

        window.view = view = new clique.view.Cola({
            model: graph,
            el: "#content",
            label: function (d) {
                return d.data.usernames[0];
            },
            fill: function (d) {
                // Red for inactive users (e.g., mentioned by others only),
                // purple for active users with non-geolocated tweets, and blue
                // for active users with geolocated tweets.
                return !d.data.active ? "#ca0020" : (d.data.geolocated ? "#0571b0" : "#7b3294");
            },
            nodeRadius: function (d, r) {
                return d.data && d.data.grouped ? 2*r : r;
            },
            postLinkAdd: function (s) {
                var cmap = function (d) {
                    return linkColormap(d.data.interaction);
                };

                s.style("fill", cmap)
                    .style("stroke", cmap);
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
                        node = graph.adapter.getAccessor(d.key),
                        left,
                        def,
                        top;

                    left = getMenuPosition(d3.event.clientX, "width", "scrollLeft");
                    top = getMenuPosition(d3.event.clientY, "height", "scrollTop");

                    ul.select("li.nodelabel")
                        .text(function () {
                            var label = d.data.usernames[0];

                            if (_.size(d.data.fullnames) > 0) {
                                label += " (" + d.data.fullnames[0] + ")";
                            }

                            return label;
                        });

                    ul.select("li.activity")
                        .text(function () {
                            if (!d.data.active) {
                                return "(This user has sent no messages and was only mentioned by someone else.)";
                            } else if (d.data.geolocated) {
                                return "(This user has sent at least one geolocated message.)";
                            } else {
                                return "(This user has sent only sent non-geolocated messages.)";
                            }
                        });

                    ul.select("a.context-hide")
                        .on("click", _.bind(clique.view.SelectionInfo.hideNode, info, node));

                    ul.select("a.context-expand")
                        .on("click", _.bind(clique.view.SelectionInfo.expandNode, info, node));

                    ul.select("a.context-collapse")
                        .on("click", _.bind(clique.view.SelectionInfo.collapseNode, info, node));

                    if (cfg.intentService) {
                        def = $.getJSON(cfg.intentService, {
                            username: d.data.usernames[0]
                        });
                    } else {
                        def = $.when({});
                    }

                    def.then(function (apps) {
                        apps = _.map(apps, function (data, app) {
                            return _.extend(data, {name: app});
                        });

                        cm.select("ul")
                            .selectAll("li.external")
                            .remove();

                        cm.select("ul")
                            .selectAll("li.external-header")
                            .remove();

                        if (_.size(apps) > 0) {
                            cm.select("ul")
                                .append("li")
                                .classed("external-header", true)
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
                                .attr("href", function (d) {
                                    return d.username;
                                })
                                .attr("target", "_blank")
                                .text(function (d) {
                                    return d.name;
                                })
                                .on("click", function () {
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
        window.info = info = new clique.view.SelectionInfo({
            model: view.selection,
            el: "#info",
            graph: graph,
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

        var fixup = _.debounce(_.partial(_.delay, function () {
            d3.select(linkInfo.el).selectAll("td")
                .each(function () {
                    var me = d3.select(this),
                        text = me.html();

                    if (!me.classed("text-right") && text.startsWith("http")) {
                        me.html("")
                            .style("max-width", "0px")
                            .style("word-wrap", "break-word")
                            .append("a")
                            .attr("href", text)
                            .attr("target", "_blank")
                            .text(text);
                    } else if (me.classed("text-right") && text === "<strong>msg</strong>") {
                        var html = [];

                        me = d3.select($(this).next().get(0));
                        text = me.html();

                        _.each(text.split(" "), function (tok) {
                            if (_.size(tok) > 2 && tok[0] === "@") {
                                html.push("<a href=\"https://twitter.com/" + tok.slice(1) + "\" target=\"_blank\">" + tok + "</a>");
                            } else if (tok.startsWith("http")) {
                                html.push("<a href=\"" + tok + "\" target=\"_blank\">" + tok + "</a>");
                            } else {
                                html.push(tok);
                            }
                        });

                        me.html(html.join(" "));
                    }
                });
        }, 100), 100);

        linkInfo.model.on("change", fixup);
        linkInfo.graph.on("change", fixup);

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

        // Process the query arguments.
        var args = tangelo.queryArguments();

        // If a node is requested in the query arguments, look for it and add it
        // if found.
        if (_.has(args, "id")) {
            graph.adapter.findNode({
                id: args.id
            }).then(function (node) {
                if (node) {
                    graph.addNode(node);
                }
            });
        }
    };

    $.getJSON("config.json")
        .then(launch, _.bind(launch, {}));
});
