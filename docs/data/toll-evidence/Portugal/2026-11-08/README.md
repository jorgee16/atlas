# Reviewed A9/A16 tariff and physical evidence

- Current rates: [IMT 2026 toll sections](https://www.imt-ip.pt/rodoviario/infraestruturas-rodoviarias/rede-rodoviaria/taxas-de-portagem/).
- `imt-tariffs.html.gz` preserves the fetched official page; the country review pins the uncompressed SHA-256 and named source cells. Eight A9 sections, four classes, no price-per-km conversion.
- Independent class checks: the existing verified Brisa 2026 directed matrix. `portugal-a9-section-fares.json` records 34 directed paths and 11 additional Alverca PV/node pairs, totaling 180 checked class cells. The 54 compiled section paths are finite reviewed paths; no missing reverse matrix cell or return-loop zero is inferred.
- Fixed A16 prices remain the [Ascendi 2026 plaza tariffs](https://ascendi.pt/portagens-tradicionais/). The canonical fixed catalog and its source cells are unchanged.
- Historical physical identities: [IMT Brisa DDIE list](https://www.imt-ip.pt/wp-content/uploads/IMTT/Portugues/InfraestruturasRodoviarias/SistemadeIdentificacaoEletronicadeVeiculos/Documents/Listagem_DDIEs_Concessao_Brisa_BRISA.pdf), vendored as `brisa-ddie-physical-only.pdf`. This is **not** a 2026 monetary source. Its grouped GPS coordinates do not identify individual adjacent lanes; source OSM way/node topology and the continuous graph witness do.
- Directed original geometries, versions, response hashes/URLs and ODbL attribution: `tools/toll-binding-config/portugal-a9-{linear,approaches}.source.json`.

The seven distributed graph files are unchanged. Every physical point and barrier-free boundary must match exactly once on that graph. A16/A9 access requires the corresponding adjacent physical Idanha crossing; starting after it cannot fabricate a partial settled ticket. A1/A10 continuations outside the reviewed settlement evidence and same-station return circuits remain unconfirmed.

No Via Verde dataset was scraped or included. The public Via Verde calculator was investigated for limited comparison; no successful simulator quote is used as proof. The public IP simulator returned HTTP 500 for the two attempted public fixture paths. Operator-site HTTP 503/403 responses were not treated as missing-price zeroes.
