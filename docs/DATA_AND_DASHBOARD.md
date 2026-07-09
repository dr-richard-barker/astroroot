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
