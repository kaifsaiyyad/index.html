KISAN SEVA TOOLS — FULL TOOL PAGE PACK
========================================
This pack contains 47 pages matching the recovered screenshot/list (please compare with your original screenshot if it showed additional tools).

FILES
- One HTML file per tool. Filenames match the `page` value in tools-catalog.json.
- tools-catalog.json is a reference catalogue for your Admin/Firestore tool entries.
- Every page links back to Home.html.

UPLOAD TO GITHUB
1. Download and extract this ZIP on your computer.
2. Open your GitHub repo: https://github.com/kaifsaiyyad/index.html
3. Click Add file → Upload files.
4. Select all 47 HTML files plus tools-catalog.json (and this README if wanted) from the extracted folder.
5. Commit message: Add all Kisan Seva Tools pages
6. Click Commit changes.
7. Wait 1–3 minutes, then test a page, e.g.:
   https://kaifsaiyyad.github.io/index.html/PassportPhotoMaker.html

IMPORTANT — CONNECT EACH TOOL IN ADMIN
For every tool document in Firestore, set:
- name = exact tool name
- category = category shown in catalogue
- icon = emoji shown in catalogue
- page = exact HTML filename, including .html
- active = true
- price = 0 (change if you charge)
Home.html uses the `page` filename to open each page. Adding a page file alone does not create a Firestore tool card.

FUNCTIONALITY NOTES
- Calculators (percentage, GST, EMI, age, date, CGPA) have working basic calculations.
- Image resizer/converter/cropper, basic image sheets, print layouts and simple document preview pages work locally in the browser.
- Image/PDF pages use browser Print → Save as PDF for a basic workflow; this is not a full PDF engine.
- Background Remover, AI tools, advanced PDF merge/split/compress, Word-to-PDF and live Gold/Silver rates need a proper external service/library/API. They are deliberately marked as needing integration instead of pretending to work. Never place private API keys in public HTML.
- Verify paper size and official ID/photo dimensions before charging customers.
- These pages do not replace your existing Home.html, Admin.html, Wallet.html, or ToolsManagement.html. Keep those files.
