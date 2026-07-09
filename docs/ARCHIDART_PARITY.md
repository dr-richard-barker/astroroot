# archiDART parity

[archiDART](https://github.com/archidart/archidart) (Delory et al. 2016, 2018) is the reference
R package for computing root-system-architecture (RSA) traits from DART and RSML files, including
a **persistent-homology** topological analysis. AstroRoot now computes the **static 2-D RSA trait
set** archiDART reports from a single RSML, plus the Fitter topological indices and a simplified
H0 geodesic persistence barcode — all in the browser (`rsml.js`), shown in the dashboard detail
view and CSV export.

This page is an honest map of what AstroRoot covers and what it doesn't.

## `architect()` traits — coverage

| archiDART trait | AstroRoot | Notes |
|---|---|---|
| **TRL** total root length | ✅ | sum of all root lengths |
| **L1R** first-order root length | ✅ | |
| **TN1R** # first-order roots | ✅ | |
| **TNLR** # lateral roots | ✅ | branching order ≥ 2 |
| **TLRL** total lateral root length | ✅ | |
| **NxLR / LxLR / MLxLR** per-order counts/lengths | ⚠️ partial | N2LR, mean lateral length reported; full per-order table not yet |
| **D2LR** secondary-root density | ✅ | N2LR / L1R |
| **Height, Width** | ✅ | bounding extent (depth, width) |
| **ConvexhullXY** hull area | ✅ | 2-D convex hull (monotone chain) |
| **ConvexhullXZ/YZ, Convexhull3D** | ❌ | needs 3-D coordinates |
| **MDx / MDLR** mean diameters | ✅* | *only if the RSML carries a `diameter` function |
| **Sx / Stot** surface area | ✅* | *from diameter × length (cylinder) |
| **Vx / Vtot** volume | ✅* | *from diameter |
| **GRTR / GR1R / GRxL** growth rates | ❌ | need a **time series** (multiple dates); AstroRoot measures one image |
| Fitter **magnitude / altitude / ExtPathLength** | ✅ | # tips, longest base→tip path, Σ tip path lengths |
| **Tortuosity** | ✅ | path length ÷ straight-line, mean over roots |

## Topology — `perhomology()` / `bottleneckdist()`

| archiDART | AstroRoot | Notes |
|---|---|---|
| H0 persistence barcode (geodesic distance) | ⚠️ simplified | one bar per root: birth = geodesic base→tip, death = geodesic base→branch-point; shown in the detail view. archiDART's `TDA`-based diagram is more rigorous |
| `bottleneckdist()` between barcodes | ❌ | pairwise topological distance — roadmap |
| `plot.barcode()` | ✅ (web) | inline SVG barcode in the record detail |

## Import / formats

| archiDART | AstroRoot |
|---|---|
| `rsmlToTable()` RSML import | ✅ `rsml.js` (nested roots, diameter, unit + resolution → cm) |
| `dartToTable()` DART (.rac/.tps/.lie) | ❌ RSML only — DART is a legacy format; export RSML instead |
| `archidraw()` / `archigrow()` plotting | ✅ partial | the dashboard draws the traits & barcode; no time-lapse growth animation |

## Honest summary

AstroRoot covers archiDART's **single-time-point, 2-D geometric + topological** trait set and
reads the same RSML files, so a teacher/student gets the core `architect()` numbers in a browser
with no R install. archiDART remains the tool of record for **growth-rate time series, full 3-D
hulls, per-order trait tables, DART files, and rigorous persistent-homology / bottleneck
distances** — for those, export your RSML and run archiDART in R. The two are complementary: same
inputs, AstroRoot for quick in-class analysis, archiDART for the full statistical/topological
pipeline.

*Demo data:* **Load sample data → Extreme stereotypes** loads five architectures at the corners of
the trait space (tap-dominant, herringbone, dichotomous, shallow-spreading, fibrous) —
AstroRoot-authored RSML in the spirit of the archiDART v3.0 topology paper (not that paper's exact
files). Click any row to see its full trait set and H0 barcode.
