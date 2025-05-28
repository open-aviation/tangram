from fastapi import APIRouter, FastAPI
from pydantic import BaseModel

# Create a router for your plugin
router = APIRouter(
    prefix="/example",  # All routes will be prefixed with /example
    tags=["example"],  # For API documentation organization
    responses={404: {"description": "Not found"}},
)


class ExampleResponse(BaseModel):
    data: str


# Define endpoints on your router
@router.get("/", response_model=ExampleResponse)
async def get_example() -> ExampleResponse:
    "An example endpoint that returns some data."
    return ExampleResponse(data="This is an example plugin response")


# This function will be called by the main FastAPI application
# Place it in __init__.py to register the plugin
def register_plugin(app: FastAPI) -> None:
    """Register this plugin with the main FastAPI application."""
    app.include_router(router)
