import pathlib
from typing import Any, Type, Tuple
from pydantic_settings import BaseSettings, SettingsConfigDict, PydanticBaseSettingsSource, YamlConfigSettingsSource


TANGRAM_PACKAGE_ROOT = pathlib.Path(__file__).resolve().parent


class TangramSettings(BaseSettings):
    model_config = SettingsConfigDict(yaml_file=[
        TANGRAM_PACKAGE_ROOT / 'settings.yml',
        TANGRAM_PACKAGE_ROOT / 'settings.custom.yml',
    ])

    host: str
    port: int
    reload: bool
    log_dir: pathlib.Path
    log_config: Any

    @classmethod
    def settings_customise_sources(
        cls, 
        settings_cls: Type[BaseSettings], 
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> Tuple[PydanticBaseSettingsSource, ...]:
        return (YamlConfigSettingsSource(settings_cls),)


tangram_settings = TangramSettings()
if not tangram_settings.log_dir.exists():
    tangram_settings.log_dir.mkdir(parents=True, exist_ok=True)

for key, handler in tangram_settings.log_config['handlers'].items():
    if 'filename' in handler:
        handler['filename'] = tangram_settings.log_dir / handler['filename']
