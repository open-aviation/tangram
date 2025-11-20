import tangram
from fastapi import APIRouter
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


plugin = tangram.Plugin(
    frontend_path="dist-frontend",
    routers=[
        # The core will add this to the main FastAPI application.
        router
    ],
)
