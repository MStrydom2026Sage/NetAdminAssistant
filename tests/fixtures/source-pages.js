/**
 * Static HTML fixtures that stand in for Sage search result pages.
 * Tests parse these strings; no network request is ever made.
 */
const KB_HTML = `
<html><body>
  <div class="result">
    <a href="/portal/app/portlets/results/viewsolution.jsp?solutionid=221045">Bank reconciliation out of balance after statement import</a>
    <p>Duplicated statement entries leave the bank reconciliation out of balance in Sage 300.</p>
  </div>
  <div class="result">
    <a href="https://za-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=118722">Day End Processing did not create costing entries</a>
    <p>Inventory Control costing is created by Day End Processing.</p>
  </div>
  <div class="result">
    <a href="https://untrusted.example.com/phishing">Bank reconciliation fix download</a>
    <p>Not an official Sage domain.</p>
  </div>
  <a href="/portal/home">Home</a>
</body></html>`;

const COMMUNITY_HTML = `
<html><body>
  <li><a href="https://communityhub.sage.com/za/sage-300/f/general-discussion/12345/bank-reconciliation-ofx-import-difference">Bank reconciliation OFX import difference</a>
  <p>Community thread about unmatched OFX statement lines.</p></li>
  <li><a href="https://communityhub.sage.com/za/sage-300-people/f/payroll/22222/paye-difference-between-periods">PAYE difference between periods</a>
  <p>Discussion about the annual equivalent used for PAYE.</p></li>
</body></html>`;

module.exports = { KB_HTML, COMMUNITY_HTML };
