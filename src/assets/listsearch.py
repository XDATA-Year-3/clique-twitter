import bson.json_util
from pymongo import MongoClient


def run(host, database, collection, field=None, value=None):
    graph = MongoClient(host)[database][collection]

    return bson.json_util.dumps(graph.find({"data.%s" % (field): {"$in": [value]}}))
