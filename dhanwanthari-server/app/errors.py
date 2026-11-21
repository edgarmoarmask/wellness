"""One error shape for the web app: {"error": code, "message": text, "issues"?: [{path, message}]}."""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, **extra):
        self.status, self.code, self.message, self.extra = status, code, message, extra


def not_found(what: str) -> ApiError:
    return ApiError(404, "not_found", f"{what} not found.")


def _clean(msg: str) -> str:
    return msg.removeprefix("Value error, ")


def install(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api(_: Request, e: ApiError):
        return JSONResponse({"error": e.code, "message": e.message, **e.extra}, status_code=e.status)

    @app.exception_handler(RequestValidationError)
    async def _invalid(_: Request, e: RequestValidationError):
        issues = [{"path": ".".join(str(p) for p in err["loc"] if p != "body"), "message": _clean(err["msg"])} for err in e.errors()]
        return JSONResponse({"error": "invalid", "message": "Please check the form.", "issues": issues}, status_code=400)

    @app.exception_handler(IntegrityError)
    async def _dup(_: Request, e: IntegrityError):
        if "UNIQUE" in str(e.orig):
            return JSONResponse({"error": "duplicate", "message": "This record already exists."}, status_code=409)
        return JSONResponse({"error": "conflict", "message": "This change conflicts with existing records."}, status_code=409)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, e: StarletteHTTPException):
        return JSONResponse({"error": "http", "message": str(e.detail)}, status_code=e.status_code)
