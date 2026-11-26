"""Build deterministic file inventories and assemble the four-target release."""

import argparse
import datetime
import hashlib
import json
import pathlib
import re
import shutil
import zipfile

TARGETS = {"linux-x86_64", "windows-x86_64", "macos-x86_64", "macos-aarch64"}
REPOSITORY = "https://github.com/Peter5235252/russian-roulette-revamped"


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def note(path, relative):
    return {"path": relative, "sha256": digest(path), "size": path.stat().st_size}


def package(target, source, binaries, output):
    output.mkdir(parents=True, exist_ok=True)
    os_name, arch = target.split("-", 1)
    suffix = ".exe" if os_name == "windows" else ""
    entry = "roulette-game" + suffix
    archive = output / f"game-{target}.zip"
    entries = [(binaries / entry, entry)]
    entries += [(file, "site/" + file.relative_to(source).as_posix())
                for file in sorted(source.rglob("*")) if file.is_file()]
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        for file, relative in entries:
            bundle.write(file, relative)
    shutil.copyfile(binaries / ("roulette-launcher" + suffix), output / f"roulette-launcher-{target}{suffix}")
    metadata = {
        "target": {"os": os_name, "arch": arch},
        "format": "zip",
        "size": archive.stat().st_size,
        "sha256": digest(archive),
        "entrypoint": entry,
        "files": [note(file, relative) for file, relative in entries],
    }
    (output / f"{target}.json").write_text(json.dumps(metadata), encoding="utf-8")


def manifest(tag, inputs, output):
    version = re.fullmatch(r"v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))", tag)
    if version is None:
        raise ValueError("Expected a release tag of the form vMAJOR.MINOR.PATCH")
    output.mkdir(parents=True, exist_ok=True)
    artifacts = []
    for target in sorted(TARGETS):
        directory = inputs / target
        metadata = json.loads((directory / f"{target}.json").read_text(encoding="utf-8"))
        game = directory / f"game-{target}.zip"
        suffix = ".exe" if target.startswith("windows-") else ""
        launcher = directory / f"roulette-launcher-{target}{suffix}"
        if digest(game) != metadata["sha256"] or game.stat().st_size != metadata["size"]:
            raise ValueError(f"Invalid archive for {target}")
        for file in (game, launcher):
            shutil.copyfile(file, output / file.name)
        metadata["url"] = f"{REPOSITORY}/releases/download/{tag}/{game.name}"
        artifacts.append(metadata)
    result = {
        "schemaVersion": 1,
        "gameVersion": version[1],
        "publishedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "releaseNotesUrl": f"{REPOSITORY}/releases/tag/{tag}",
        "minimumLauncherVersion": "0.1.0",
        "artifacts": artifacts,
    }
    (output / "manifest.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    checksums = [f"{digest(file)}  {file.name}" for file in sorted(output.iterdir())]
    (output / "SHA256SUMS").write_text("\n".join(checksums) + "\n", encoding="utf-8")


parser = argparse.ArgumentParser()
commands = parser.add_subparsers(dest="command", required=True)
build = commands.add_parser("package")
build.add_argument("target", choices=sorted(TARGETS))
for name in ("source", "binaries", "output"):
    build.add_argument(name, type=pathlib.Path)
assembly = commands.add_parser("manifest")
assembly.add_argument("tag")
for name in ("inputs", "output"):
    assembly.add_argument(name, type=pathlib.Path)
args = parser.parse_args()
if args.command == "package":
    package(args.target, args.source, args.binaries, args.output)
else:
    manifest(args.tag, args.inputs, args.output)
