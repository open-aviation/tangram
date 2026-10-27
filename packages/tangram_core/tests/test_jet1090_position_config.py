import pytest
from pydantic import TypeAdapter, ValidationError

# The CI test job for tangram_core runs without any plugin installed, so this
# file may only test the plugin when it is present in the environment.
tangram_jet1090 = pytest.importorskip("tangram_jet1090")

PlanesConfig = tangram_jet1090.PlanesConfig


def test_position_expiry_does_not_inherit_aircraft_retention():
    config = TypeAdapter(PlanesConfig).validate_python({"state_vector_expire": 120})
    assert config.state_vector_expire == 120
    assert config.position_expire == 20


def test_position_expiry_can_be_configured_independently():
    config = TypeAdapter(PlanesConfig).validate_python(
        {"state_vector_expire": 120, "position_expire": 5}
    )
    assert config.position_expire == 5
    assert config.state_vector_expire == 120


@pytest.mark.parametrize("expiry", [0, -1, 65536])
def test_position_expiry_requires_a_positive_u16(expiry):
    with pytest.raises(ValidationError):
        TypeAdapter(PlanesConfig).validate_python({"position_expire": expiry})
