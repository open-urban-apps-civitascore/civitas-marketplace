/**
 * The package repositories' validator, verbatim (commune-musterbach-kiez-baumkataster/ci/validate-bundle.py
 * as of 2026-09-08). It travels with every exported package so the receiving repository's CI and a
 * contributor's local check apply the same rules the export pre-checked with (lib/export/package-check.ts
 * mirrors the essential ones). Regenerate from the package repo when the validator changes.
 */
export const VALIDATE_BUNDLE_SCRIPT = String.raw`#!/usr/bin/env python3
"""CORE-IR package validator (catalogue format v2).

The package document is core-ir/manifest.json: catalogue manifest plus the
member file list (raw URLs cannot list directories, so the manifest is the only
way a package can say what it consists of). This validator checks that the
package hangs together:

  - manifest.json present, well-formed, all required fields
  - every listed member file exists; no unlisted JSON strays in core-ir/
  - per-kind invariants (structure $id/title, connector id/title/connectionType,
    mapping mappingUrn/document, pipeline name/model)
  - references resolve WITHIN the package: mapping source/target -> bundled
    structure $ids; pipeline sourceRef/sinkRef/mappingRef -> member titles/names
    (or pass through as explicit URNs)
  - datastructure entries: exactly one structure member, id == its $id
"""
import json
import os
import sys

CORE = "core-ir"
MEMBER_KINDS = ("dataStructures", "dataSources", "mappings", "dataSinks", "pipelines", "simulations", "dashboards")
GENERATOR_KINDS = {
    "constant": (),
    "now": (),
    "enum": ("values",),
    "randomWalk": ("min", "max", "step"),
    "dailyProfile": ("min", "max", "peakHours"),
    "sequence": (),
    "jitter": ("center", "spread"),
}
errors = []


def fail(msg):
    errors.append(msg)


def load_json(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except json.JSONDecodeError as exc:
        fail(f"{path}: invalid JSON ({exc})")
        return None


manifest_path = os.path.join(CORE, "manifest.json")
if not os.path.exists(manifest_path):
    print(f"FAIL: {manifest_path} is missing")
    sys.exit(1)

manifest = load_json(manifest_path)
if manifest is None:
    print(f"FAIL: {manifest_path} is not valid JSON")
    sys.exit(1)

for field in ("id", "type", "version", "displayName", "description", "maintainer", "license", "keywords", "members", "dependencies"):
    if field not in manifest:
        fail(f"manifest.json is missing required field '{field}'")

entry_type = manifest.get("type")
if entry_type not in ("usecase", "datastructure"):
    fail(f"manifest.json: type must be 'usecase' or 'datastructure', got {entry_type!r}")

members = manifest.get("members") or {}
listed_files = []
for kind in MEMBER_KINDS:
    for index, member in enumerate(members.get(kind) or []):
        if not isinstance(member, dict) or not isinstance(member.get("file"), str):
            fail(f"members.{kind}[{index}] needs a 'file' string")
            continue
        listed_files.append((kind, member["file"]))

# Every listed file must exist; every JSON in core-ir/ must be listed (or be
# the manifest) — an unlisted file would silently not travel.
on_disk = {name for name in os.listdir(CORE) if name.endswith(".json")}
for kind, name in listed_files:
    if name not in on_disk:
        fail(f"members.{kind} lists '{name}' but {CORE}/{name} does not exist")
for name in sorted(on_disk - {"manifest.json"} - {name for _, name in listed_files}):
    fail(f"{CORE}/{name} exists but is not listed in manifest members")

documents = {}
for kind, name in listed_files:
    path = os.path.join(CORE, name)
    if not os.path.exists(path):
        continue
    document = load_json(path)
    if document is not None:
        documents[(kind, name)] = document

structure_ids, source_titles, sink_titles, mapping_names = set(), set(), set(), set()

for (kind, name), document in documents.items():
    where = f"{CORE}/{name}"
    if kind == "dataStructures":
        declared = document.get("$id")
        if not isinstance(declared, str) or not declared.startswith("urn:core:"):
            fail(f"{where}: structure needs a CORE-URN $id")
        else:
            structure_ids.add(declared)
        if not isinstance(document.get("title"), str) or not document["title"]:
            fail(f"{where}: structure needs a title (it is the shell's display name)")
    elif kind in ("dataSources", "dataSinks"):
        for field in ("$schema", "id", "title", "connectionType"):
            if not isinstance(document.get(field), str) or not document[field]:
                fail(f"{where}: connector needs field '{field}'")
        if isinstance(document.get("title"), str):
            (source_titles if kind == "dataSources" else sink_titles).add(document["title"])
    elif kind == "mappings":
        for field in ("mappingUrn", "name"):
            if not isinstance(document.get(field), str) or not document[field]:
                fail(f"{where}: mapping needs field '{field}'")
        inner = document.get("document")
        if not isinstance(inner, dict):
            fail(f"{where}: mapping needs an object field 'document'")
        else:
            for field in ("source", "target", "fields"):
                if field not in inner:
                    fail(f"{where}: mapping document needs field '{field}'")
        if isinstance(document.get("name"), str):
            mapping_names.add(document["name"])
        if isinstance(document.get("mappingUrn"), str):
            mapping_names.add(document["mappingUrn"])
    elif kind == "pipelines":
        if not isinstance(document.get("name"), str) or not document["name"]:
            fail(f"{where}: pipeline needs field 'name'")
        model = document.get("model")
        if not isinstance(model, dict) or not isinstance(model.get("nodes"), list):
            fail(f"{where}: pipeline needs model.nodes")
    elif kind == "simulations":
        required = ("sourceRef", "messageClass")
        for field in required:
            if not isinstance(document.get(field), str) or not document[field]:
                fail(f"{where}: simulation needs field '{field}'")
        if document.get("transport") == "sql":
            # A table, not a topic: the generator owns the table's lifetime.
            if not isinstance(document.get("table"), dict):
                fail(f"{where}: a SQL scenario needs a 'table' with columns")
            if not isinstance(document.get("fields"), dict) or not document["fields"]:
                fail(f"{where}: a SQL scenario needs a non-empty fields object")
        else:
            if not isinstance(document.get("topicBase"), str) or not document["topicBase"]:
                fail(f"{where}: simulation needs field 'topicBase'")
            if not isinstance(document.get("streams"), list) or not document["streams"]:
                fail(f"{where}: simulation needs a non-empty streams array")


def _deref(node, root, where):
    """Follow a bundle-internal '#/...' $ref; returns the node itself otherwise."""
    ref = node.get("$ref")
    if not isinstance(ref, str):
        return node
    if not ref.startswith("#/"):
        fail(f"{where}: cannot follow external $ref '{ref}'")
        return {}
    target = root
    for segment in ref[2:].split("/"):
        if not isinstance(target, dict) or segment not in target:
            fail(f"{where}: $ref '{ref}' does not resolve")
            return {}
        target = target[segment]
    return target if isinstance(target, dict) else {}


def validate_simulation(document, where):
    """Field paths must exist in the message class (subset), and every required
    property — top-level and of every object a path steps into — must be
    produced (coverage). Mirrors lib/catalog/assemble.ts in the marketplace."""
    source = next(
        (d for (k, n), d in documents.items() if k == "dataSources" and d.get("title") == document["sourceRef"]),
        None,
    )
    if source is None:
        fail(f"{where}: sourceRef '{document['sourceRef']}' matches no bundled datasource title")
        return
    structure = next(
        (d for (k, n), d in documents.items() if k == "dataStructures" and d.get("$id") == source.get("element")),
        None,
    )
    if structure is None:
        fail(f"{where}: datasource '{document['sourceRef']}' names structure '{source.get('element')}', which is not bundled")
        return

    pointer = document["messageClass"]
    message_class = structure if pointer == "#" else _deref({"$ref": pointer}, structure, where)
    if not message_class:
        return

    # A SQL scenario has no streams: a table is one shape, not many. Its fields
    # are checked against the declared columns as well as against the structure,
    # because a name that is not a column fills nothing (D14).
    if document.get("transport") == "sql":
        table = document.get("table") or {}
        columns = list((table.get("columns") or {}).keys())
        if not columns:
            fail(f"{where}: a SQL scenario must declare its table columns")
            return
        key = table.get("primaryKey")
        if key and key not in columns:
            fail(f"{where}: primaryKey '{key}' is not among the declared columns")
        if document.get("maxRows") is None:
            fail(f"{where}: maxRows is required for SQL - every pipeline run re-reads the whole table")
        for name in (document.get("fields") or {}):
            if name not in columns:
                fail(f"{where}: field '{name}' is not a declared column of the table")
        units = [{"name": "Tabelle", "fields": document.get("fields") or {}}]
    else:
        units = document["streams"]

    for stream in units:
        stream_name = stream.get("name", "?")
        covered = set()
        for path, spec in (stream.get("fields") or {}).items():
            kind_name = spec.get("kind") if isinstance(spec, dict) else None
            if kind_name not in GENERATOR_KINDS:
                fail(f"{where}: stream '{stream_name}' field '{path}' has unknown generator kind '{kind_name}'")
                continue
            for operand in GENERATOR_KINDS[kind_name]:
                if operand not in spec:
                    fail(f"{where}: stream '{stream_name}' field '{path}' ({kind_name}) is missing '{operand}'")
            node = _deref(message_class, structure, where)
            walked = ""
            for segment in path.split("."):
                walked = f"{walked}.{segment}" if walked else segment
                properties = node.get("properties")
                if not isinstance(properties, dict) or segment not in properties:
                    fail(f"{where}: field '{path}' — '{walked}' is not a property of {pointer}")
                    break
                covered.add(walked)
                node = _deref(properties[segment], structure, f"{where}: {walked}")

        def require_covered(node, prefix):
            for required_name in node.get("required") or []:
                full = f"{prefix}.{required_name}" if prefix else str(required_name)
                if not any(c == full or c.startswith(full + ".") for c in covered):
                    fail(f"{where}: stream '{stream_name}' does not produce required field '{full}' of {pointer}")

        resolved_class = _deref(message_class, structure, where)
        require_covered(resolved_class, "")
        for parent in {c for c in covered if "." not in c}:
            properties = resolved_class.get("properties") or {}
            if parent in properties and any(c.startswith(parent + ".") for c in covered):
                require_covered(_deref(properties[parent], structure, where), parent)


for (kind, name), document in documents.items():
    if kind == "simulations":
        validate_simulation(document, f"{CORE}/{name}")

# Cross-references must resolve within the package (URNs pass through: they
# reference something already installed on the target instance).
for (kind, name), document in documents.items():
    where = f"{CORE}/{name}"
    if kind == "mappings" and isinstance(document.get("document"), dict):
        for side in ("source", "target"):
            ref = document["document"].get(side)
            if isinstance(ref, str) and ref not in structure_ids:
                fail(f"{where}: mapping {side} '{ref}' is not a bundled structure $id")
    if kind == "pipelines" and isinstance(document.get("model"), dict):
        for node in document["model"].get("nodes") or []:
            if not isinstance(node, dict):
                continue
            for ref_field, known, label in (
                ("sourceRef", source_titles, "datasource title"),
                ("sinkRef", sink_titles, "datasink title"),
                ("mappingRef", mapping_names, "mapping name/urn"),
            ):
                ref = node.get(ref_field)
                if isinstance(ref, str) and not ref.startswith("urn:") and ref not in known:
                    fail(f"{where}: node '{node.get('id')}' {ref_field} '{ref}' matches no bundled {label}")

# Entry-type invariants.
structure_members = members.get("dataStructures") or []
if entry_type == "datastructure":
    if len(structure_members) != 1:
        fail(f"datastructure entry must have exactly one dataStructures member, found {len(structure_members)}")
    other = [kind for kind in MEMBER_KINDS[1:] if members.get(kind)]
    if other:
        fail(f"datastructure entry must not have members of kind: {', '.join(other)}")
    if structure_members and documents.get(("dataStructures", structure_members[0].get("file"))):
        declared = documents[("dataStructures", structure_members[0]["file"])].get("$id")
        if declared != manifest.get("id"):
            fail(f"datastructure entry id '{manifest.get('id')}' does not match the artifact $id '{declared}'")
elif entry_type == "usecase":
    if not structure_members:
        fail("usecase entry needs at least one dataStructures member")

if errors:
    print("Package validation FAILED:")
    for err in errors:
        print("  -", err)
    sys.exit(1)

print(f"Package OK — {manifest_path} + {len(listed_files)} member file(s)")
`
