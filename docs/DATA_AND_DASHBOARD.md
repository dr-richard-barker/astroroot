# Markers, data & the dashboard

## Scale & colour markers (PlantCV-compatible)

AstroRoot can auto-detect a **colour/scale card** in the frame and use it for *both* colour
normalisation *and* the pixel→cm scale — mirroring PlantCV's
[`detect_color_card`](https://docs.plantcv.org/en/stable/transform_detect_color_card/)
(`color_chip_size=…`). Pick the card in **Marker / scale**, then **Auto-detect**:

| Marker type | PlantCV equivalent | AstroRoot does |
|---|---|---|
| ColorChecker **Classic (24)** | `detect_color_card(color_chip_size="classic")` | detect grid, **full colour correction** to the 24 sRGB references + scale |
| **Passport / Mini / Nano / CameraTrax** | `color_chip_size="passport"/"mini"/"nano"/"cameratrax"` | detect grid, **grey-world white balance** + scale |
| **AstroCalibration Spectrum** | custom `color_chip_size` (mm) | same, with the AIRI sticker's chip pitch |
| **Size marker — known length** | [`report_size_marker_area`](https://docs.plantcv.org/en/stable/report_size_marker/) | click the marker's two ends, enter its length → scale |
| **Manual — 2 points** | — | click any two points a known distance apart |

**Scale** comes from the detected chip pitch: `px/cm = (card width ÷ columns) ÷ (chip pitch cm)`.
The chip-pitch mm field is pre-filled per card and **editable** — set it to your actual card so
the scale is correct. **Colour correction** fits detected chip colours toward references (Classic)
or greys the neutral chips (other cards) and is applied to the image before tracing.

> This is a PlantCV-**compatible** detector (same card families, same reference matrix), written
> in JavaScript so it runs in the browser. For byte-for-byte PlantCV output, run the Python
> `detect_color_card` path on the same image — the card types line up.

Detection is best-effort on a clean card against a plain background; if it can't find the card it
says so — use **Manual 2-pt** as the reliable fallback.

## Your data — saved on your device

Every analysis can be saved to a **local database** (the browser's IndexedDB) with **Save to
database** (single) or **Save all to database** (batch). Records hold the measurements, the
engine + marker used, the calibration, and a thumbnail. **Nothing leaves your device.**

- **Dashboard** (📊 in the nav, or `dashboard.html`): browse every saved measurement —
  summary stats, a length histogram, a tips-vs-length scatter, and a searchable, sortable table
  with per-row thumbnails and delete. Inspired by Nottingham's
  [RootNav-Viewer 2.0](https://github.com/robail-yasrab/RootNav-Viewer-2.0) (a Windows RSML
  browser), reimagined as a dependency-free web page.
- **Export**: CSV (for a spreadsheet/stats) or JSON (a full backup you can re-import on another
  machine). **Import** merges a JSON backup back in.

### Sample data & RSML import

- **🌱 Load sample data** drops in a real dataset — the **18-way skew** experiment (53 RootNav
  RSML plates, agar/phytogel × concentration × sucrose), so the charts and table have something
  to show immediately. Records use stable ids, so loading twice won't duplicate. (Source:
  [`18_way_skew`](https://github.com/dr-richard-barker/image-analysis-software-and-R-codes/tree/master/18_way_skew).)
- **Import RSML** reads any RootNav `.rsml` files (from RootNav 1 / 2.0 / RootNav-Viewer) and
  computes the full **[archiDART-comparable trait set](ARCHIDART_PARITY.md)**: total & per-order
  root length, # first-order/lateral roots, lateral density, height/width, convex-hull area,
  diameter → surface/volume (if the RSML carries a diameter function), tortuosity, the Fitter
  topological indices (magnitude, altitude, external path length), and a simplified **H0
  geodesic persistence barcode**. Units come from the RSML metadata (unit + resolution → cm; or
  px). Parser: `rsml.js`.
- **Click any table row** to open the record detail — a **drawing of the root system** (from the
  RSML geometry, coloured by branching order; or the saved image for a live analysis), the full
  trait grid, and its H0 barcode. RSML rows also show a thumbnail sketch in the table.

### Regions of interest — label roots by area (e.g. genotype)

When one image holds more than one genotype or treatment (a common plate layout — e.g. the ABRS
demo has two panels), you don't need to crop it. On the **Single** tab click **✏️ Draw region**,
drag a box over each area, and name it (e.g. a genotype). After **Trace roots**, each region is
**measured separately** — a *Per-region* table shows length/tips/branches/**angle** for each — and
**Save regions to database** stores one record per region **tagged with the region name as its
group**. Then the dashboard's group summary compares them directly (e.g. mean skew angle of a
skewing genotype vs a non-skewing one). Regions persist across images of the same layout, so you
can draw them once and apply the same boxes to each frame.

### Multiple plants — mark each seed (per-plant traits)

One plate usually holds several seedlings. Tell AstroRoot how many (**plants: N**) and where each
seed was sown — the **root's starting point**. Click **🌱 Auto-place** to drop N markers on the
brightest shoot columns, or **Place seeds** to click each one. After **Trace roots**, a
**Per-plant** table gives each plant its own length, tips, and a **signed seed→tip skew angle**
(the handedness that separates a skewing genotype from a straight one). If you also drew genotype
regions, **each plant is tagged with the genotype whose region contains its seed** — so
**Save plants to database** writes one record per plant, grouped by genotype, giving proper
**per-plant replication** (n = plants) for the dashboard comparison.

### Batch across a timelapse (regions + seeds applied to every frame)

Define the genotype **regions** and **seeds** once on the Single tab, then switch to **Batch**,
load the whole folder/timelapse, and **Process all** — the same regions and seeds are applied to
**every frame**. With seeds defined you get **one record per plant per frame** (e.g. 10 plants ×
8 frames = 80 rows), each tagged with its genotype and carrying its **frame** name; frames are
timestamped in order so each plant's trait **trajectory over time** is preserved. Save them and
the dashboard compares genotypes across the whole series (and the CSV has `frame, group, plant`
columns for your own stats). The batch note tells you exactly what will be applied before you run.

The dashboard then draws a **Per-plant trajectory** chart: a thin line for every plant and a bold
line for each **genotype mean**, over the frames — switch the metric between **angle/skew**,
length, or tips. For the classic skew comparison, watch the skewing genotype's mean drift away
from zero while the straight one stays flat.

### Groups & group summaries

- **Tick the checkboxes** on any rows (or *select all filtered*) and click **Group selected…** to
  tag them as a named group; **Ungroup** clears it. A **Group summary** table shows per-group
  means (length, TRL, tips, branches, angle), and the **show group** filter narrows the table to
  one group. Groups are saved with the records (and included in CSV/JSON export and cloud sync).
- Great for a Flight-vs-Ground or genotype comparison: load a dataset, group it, read the summary.

### TICTOC cotton (Flight vs Ground)

**Load sample data → TICTOC cotton** loads 24 real cotton root systems from the ISS
[TICTOC study](https://github.com/dr-richard-barker/TICTOC) (`Data/Final_RSML_format`, day-6
subset, genotypes WT/A68/D130), **pre-grouped Flight vs Ground** so the group summary is populated
immediately. *Caveat:* these SmartRoot RSML carry a nominal `resolution`, so **absolute lengths
are uncalibrated** — read the **Flight-vs-Ground contrast**, not the absolute cm.
- **Extreme stereotypes** (in the *Load sample data* menu) drops in AstroRoot's own set of five
  reference architectures at the corners of the trait space — tap-dominant, herringbone,
  dichotomous, shallow-spreading, fibrous — to show how the traits and barcodes differ. They're
  generated, versioned RSML (`scripts/gen_stereotypes.py`), reproducible and license-clean; the
  topology idea follows the archiDART v3.0 paper (Delory et al. 2018).

## Cloud sync — Supabase (metadata only)

AstroRoot stays **local-first** (images never leave the device), but you can sync the
**measurements** (metadata only — no images or thumbnails) to a shared **Supabase** table so a
class or lab can pool results. It's on the **Dashboard → ☁️ Cloud sync** panel.

### One-time setup

1. Create a free project at [supabase.com](https://supabase.com) (you do this — it needs an
   account; AstroRoot never creates accounts or handles your password).
2. In the project's **SQL Editor**, run [`supabase/schema.sql`](../supabase/schema.sql). It
   creates the `measurements` table, **enables Row Level Security**, and adds a policy. Pick
   *Option A* (open anon read/write — fine for a trusted classroom) or *Option B* (per-user,
   once you add sign-in).
3. In **Project Settings → API**, copy the **Project URL** and the **`anon` `public` key**.
   > ⚠️ Use the **anon (publishable)** key only. **Never** paste the `service_role` secret into
   > a browser app — it bypasses RLS. The anon key is safe to use client-side *because* RLS is on.
4. On the Dashboard, open **☁️ Cloud sync**, paste the URL + anon key + table name, **Save
   settings** (stored only in your browser's localStorage — never committed anywhere), then
   **Test connection**.

### Using it

- **⬆ Sync up** pushes your local records to Supabase (upsert by `id`, so re-syncing is safe and
  won't duplicate). **Thumbnails are stripped before upload** — only the 12 metadata fields go.
- **⬇ Pull to local** fetches the shared table into your local database so the dashboard shows
  everyone's rows.
- **Forget keys** removes the credentials from this browser.

### What crosses the wire

Exactly these columns: `id, ts, name, engine, marker, px_per_cm, length_val, length_unit,
color_corrected, tips, branches, angle`. **No image, no thumbnail, no pixel data.** If later you
want per-student ownership, switch the schema to *Option B* and add Supabase Auth — the sync code
already sends the anon/authenticated key, so only the policy changes.
