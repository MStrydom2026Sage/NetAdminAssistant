# NetAdmin Assistant extension

Load `extension/` as an unpacked Chrome MV3 extension. On NetAdmin/Sage ticket pages, click the floating green button for the side panel, or the extension icon for the popup. Analysis and scoped Sage/IT chat run locally using deterministic rules; no helper server or API key is required. The panel displays suggested checks and a customer-safe draft reply.

Only already-scraped ticket fields and attachment names are used. Files are not downloaded or uploaded. The extension makes no background network requests. Optional Sage Help and Community links are not search results and may open external websites when clicked. Review all suggestions before using them. If the ticket cannot be scraped, refresh the page and check selectors in `content.js`.
