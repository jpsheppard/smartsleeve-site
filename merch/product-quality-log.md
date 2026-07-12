# SmartSleeve Merch Product Quality Log

This log records physical product tests, quality decisions, and discontinued merchandise. A product marked **Discontinued** must not appear in the public catalog or be accepted by checkout unless a later dated entry documents a replacement product and an approved physical sample.

## 2026-07-12 — Printful Accessories

### SmartSleeve Beach Towel

- **Decision:** Approved to remain on sale
- **Quality assessment:** Acceptable, but not excellent

A physical SmartSleeve Beach Towel was received and evaluated on July 12, 2026. Its quality was acceptable for continued sale, although it did not test as highly as the approved apparel, bandanas, or socks. The current Printful beach-towel product may remain in the merch store.

### SmartSleeve and SQTS Bandanas

- **Decision:** Approved
- **Quality assessment:** Excellent

Physical SmartSleeve and SQTS bandanas were received and evaluated on July 12, 2026. Both designs tested as excellent-quality merchandise and are approved to remain in the merch store.

### SmartSleeve Crew Socks

- **Decision:** Approved
- **Quality assessment:** Excellent
- **Production-art constraint:** SS chip logo only; no `SmartSleeve` name beneath the logo

Physical SmartSleeve crew socks were received and evaluated on July 12, 2026. The sock quality tested as excellent and the product is approved to remain in the merch store.

Printful revised the sock artwork for production. The manufactured SmartSleeve sock uses only the SS chip logo and does not include the `SmartSleeve` name beneath it. This is an artwork constraint, not a product-quality defect. Storefront imagery must show the production-accurate SS-only design; a mockup displaying the SS logo plus the `SmartSleeve` name is obsolete and must not be used as the customer-facing representation.

The Printful-supplied preview included with the order also displayed the obsolete SS-plus-`SmartSleeve` treatment and did not match the delivered product. For this product, the received physical sample is the source of truth for customer-facing imagery. The storefront therefore uses metadata-stripped photos of the received socks for both the main product view and the embroidery detail inset.

### Approval scope

These decisions cover the current Printful product blanks, print methods, artwork configurations, and fulfillment setup tested above. Retest a physical sample if any of those materially change, and record the later decision in this log.

## 2026-07-11 — Printful Gym Towels

- **Decision:** Discontinued
- **Effective date:** July 11, 2026

**Products affected:**

- SmartSleeve Gym Towel / SS Gym Towel
- SQTS Gym Towel
- Any future storefront listing that uses the same Printful gym-towel product without a new physical quality approval

### Product test

A physical SmartSleeve SS Gym Towel fulfilled by Printful was received and evaluated on July 11, 2026. Its overall product quality was extremely poor and unacceptable for sale under the SmartSleeve brand. The sample failed the product-quality test, so the Printful gym-towel product was discontinued immediately.

Although the tested sample carried the SS design, the SQTS Gym Towel used the same Printful gym-towel product category. Both SS and SQTS versions were therefore removed rather than exposing customers to the same underlying quality risk.

### Storefront enforcement

The discontinuation is enforced in multiple layers:

- removed from the checked-in public storefront catalog;
- filtered from the shop frontend if it appears in stale catalog data;
- excluded from future Printful catalog synchronization;
- excluded from the checkout Worker catalog; and
- rejected by direct checkout requests using an old gym-towel product key.

Historical mockups or production assets may remain in the repository as internal records. Their presence does not mean the product is approved or available for sale.

### Conditions for reconsideration

Do not restore a gym towel based only on a digital mockup or provider listing. Reconsideration requires:

1. a materially different product blank, fulfillment source, or supplier;
2. a new physical sample received by SmartSleeve;
3. documented approval of material, construction, print quality, color, finish, and overall customer value; and
4. a later entry in this log explicitly changing the status from **Discontinued** to **Approved**.

## Early July 2026 — Current Printful Apparel

- **Decision:** Approved
- **Test period:** Early July 2026

**Products approved:**

- Printful men's T-shirts
- Printful men's tank tops
- Printful men's muscle tees
- Printful women's racerback tanks, displayed in the storefront as women's tanks

### Product tests

Physical samples of the current Printful men's T-shirts, men's tank tops, men's muscle tees, and women's racerback tanks were received and evaluated in early July 2026. All four product types tested as high-quality merchandise and were approved for sale under the SmartSleeve and SQTS brands.

The approval covers the current Printful product blanks and fulfillment configurations used by the storefront, including the applicable SS and SQTS artwork/back-design variants. The physical product quality—not the digital mockup alone—is the basis for approval.

### Approval scope

This approval does not automatically carry over to a materially different blank, manufacturer, supplier, print method, or fulfillment configuration. Retest a physical sample if Printful changes the underlying product or if SmartSleeve replaces it with a different catalog item. Record any later approval, restriction, or discontinuation in this log.
