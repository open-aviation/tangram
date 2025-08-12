import os
import subprocess
from pathlib import Path

PATH_ROOT = Path(__file__).parent.parent.resolve()
PATH_PACKAGES = PATH_ROOT / "packages"


def build_maturin(pkg: Path):
    subprocess.run(
        [
            "maturin",
            "build",
            "--release",
            "--sdist",
            "--auditwheel",
            "repair",
            "-o",
            PATH_ROOT / "dist",
        ],
        cwd=pkg,
        check=True,
    )


def test_main():
    os.chdir(PATH_ROOT)
    os.system("pnpm install")
    os.system("pnpm build")
    for package in [
        "tangram_example",
        "tangram_jet1090",
        "tangram_system",
        "tangram_weather",
    ]:
        os.system(f"uv build --package {package}")
    build_maturin(PATH_PACKAGES / "tangram")
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
    command += f' "{main}" --force-reinstall'
    os.system(command)


# podman run -d --name redis -p 127.0.0.1:6379:6379 redis:latest

if __name__ == "__main__":
    test_main()
