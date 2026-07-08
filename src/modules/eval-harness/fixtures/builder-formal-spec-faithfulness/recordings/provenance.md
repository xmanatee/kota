# Recording Provenance

The `build` and `critic-review` recordings are synthetic smoke-fixture
recordings, both using source run id
`synthetic-builder-formal-spec-faithfulness-2026-07-08`.

They are generated from the fixture's golden calibration files so replayed eval
runs exercise the same faithful executable spec and result artifact that
verifier calibration accepts. The fixture has no matching historical KOTA
failure run; its provenance is the local measurement gap described in
`notes.md` and `fixture.json`.
