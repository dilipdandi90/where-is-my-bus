# Indian Railways timetable

Builds `backend/src/main/resources/feeds/indian-rail.zip` from Indian Railways' official timetable,
**Trains at a Glance 2026** (valid from 1 January 2026), published by IRCTC as an online flipbook.

The flipbook has no download: each page is an image, and the book's search index holds each page's
text, which has every number exactly right but loses the table layout. So this reads both:

1. **Grid** (`grid.mjs`): finds the table's blue cell lines on the page image, giving every train
   column and station row.
2. **Cells** (`read-page.mjs`): reads each cell on its own with OCR (Tesseract): times as digits only,
   names as text, after removing the coloured backgrounds and the boxes around first and last times.
3. **Check**: every time read is aligned with the page's exact text (a longest-common-subsequence
   alignment), which corrects misread digits. Anything that can't be confirmed is marked and left out,
   never guessed.
4. **Join** (`build-rail.mjs`):
   - train numbers from the exact text, official names from the book's train index;
   - station names aligned with the page's exact names, then matched to a code and position
     (OpenStreetMap's current codes first, DataMeet's 2016 list for gaps) with a trigram index and
     edit distance;
   - each train's pieces from different tables merged in order with a topological sort, and day
     numbers added where times pass midnight.
5. **Feed** (`make-gtfs.mjs`): a GTFS feed the server loads like the bus feeds, with times past 24:00
   for trains that take more than a day.

## Running it

```
cd tools/indian-rail
npm install
npm run fetch   # book text, station index, station positions (a few minutes)
npm run read    # every timetable page: ~406 pages, an hour or more; safe to stop and re-run
npm run build   # trains and the feed
```

Then restart the backend. For a new edition, change the book's address in `fetch.mjs` and
`batch.mjs`.

## Limits

- Trains at a Glance lists mail and express trains (about 1,400 numbers) and their main stops, not
  every halt, passenger train or local.
- A few cells (notes such as "Hadapsar Dep 08.10") can't be confirmed and are left out; the read step
  reports how many per page.
- The book is IRCTC's publication: only the timetable facts are used, never its pages.
