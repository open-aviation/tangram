#!/usr/bin/env python
# coding: utf8

from fastapi import APIRouter

app = APIRouter(
    prefix="/history",
    on_startup=[],
    on_shutdown=[],
)
