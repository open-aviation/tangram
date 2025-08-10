import os
from pathlib import Path

PATH_ROOT = Path(__file__).parent.parent.resolve()
PATH_PACKAGES = PATH_ROOT / "packages"


def test_main():
    os.chdir(PATH_ROOT)
    os.system("pnpm install")
    os.system("pnpm build")
    os.system("uv build --all-packages")
    plugins = []
    main: Path | None = None
    for wheel in PATH_ROOT.glob("dist/*.whl"):
        if wheel.name.startswith("tangram-"):
            main = wheel
        else:
            plugins.append(wheel)
    assert main is not None

    command = "uv tool install"
    for plugin in plugins:
        command += f" --with {plugin}"
    command += f' "{main}[cli]" --force-reinstall'
    os.system(command)


if __name__ == "__main__":
    test_main()
