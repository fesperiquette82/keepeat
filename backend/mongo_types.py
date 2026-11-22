"""Types des objets MongoDB (Motor) passés aux modules du backend.

`server.py` crée le client et les collections ; les modules de service les
reçoivent en paramètre. Ces alias leur donnent un type précis (BUG-088) : mypy
vérifie alors l'usage réel des collections (`find_one` peut rendre `None`…).
"""
from typing import Any, TypeAlias

from motor.motor_asyncio import AsyncIOMotorCollection, AsyncIOMotorDatabase

MongoDocument: TypeAlias = dict[str, Any]
MongoCollection: TypeAlias = AsyncIOMotorCollection[MongoDocument]
MongoDatabase: TypeAlias = AsyncIOMotorDatabase[MongoDocument]
