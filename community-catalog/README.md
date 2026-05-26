# Mkfd Community Catalog

The community catalog contains public feed recipes that Mkfd instances can browse and import without waiting for an application release.

To browse recipes, run Mkfd and open the Catalog page. Imported recipes become normal local feed configs.

Contribution rules:

- Do not include secrets, cookies, protected values, or private network URLs.
- Do not submit `email` or `serviceConnector` feeds.
- Prefer public, stable sources that are useful to other Mkfd users.
- Keep selectors and mappings specific enough to avoid noisy feeds.

To submit a recipe, use the "Submit to Community Catalog" flow in Mkfd, then open a pull request with the generated bundle.

Review focuses on public source accessibility, safety, usefulness, and whether the recipe can be validated without private credentials.
