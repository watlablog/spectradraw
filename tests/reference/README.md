# Python reference fixtures

`generate_fixtures.py` captures the numerical conventions used by the PyCon JP
reference implementation. Python is only required when regenerating fixtures;
it is not part of the web application, its build, or its runtime.

Pinned reference environment:

```sh
python -m venv .reference-venv
.reference-venv/bin/pip install -r tests/reference/requirements.txt
.reference-venv/bin/python tests/reference/generate_fixtures.py
```

Run the script from this directory and review fixture changes before committing
them. JavaScript Griffin–Lim output is intentionally not compared sample for
sample because SpectraDraw uses its own deterministic seeded PRNG.
