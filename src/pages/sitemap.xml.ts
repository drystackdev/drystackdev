import type { APIContext } from "astro";
import { getBlogPosts, getSeoKnowledgePosts } from "../data/blog";
import { getServices } from "../data/services";

// Every page is server-rendered (astro.config.mjs's `output: "server"`), so
// there's no build-time list of generated static files left for
// @astrojs/sitemap to read - that integration only ever sees pages Astro
// actually prerendered, and under full SSR it would silently stop listing
// every blog/service/knowledge-base page (see astro.config.mjs's comment).
// This route rebuilds the sitemap from the same content sources the pages
// themselves read, so it's exactly as current as the site is - no separate
// rebuild step to keep it in sync.
function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

type Url = { loc: string; lastmod?: string };

export async function GET(context: APIContext) {
	const [blogPosts, seoKnowledgePosts, services] = await Promise.all([
		getBlogPosts(),
		getSeoKnowledgePosts(),
		getServices(),
	]);

	const urls: Url[] = [
		{ loc: "/" },
		{ loc: "/gioi-thieu" },
		{ loc: "/blog" },
		{ loc: "/kien-thuc-seo" },
		{ loc: "/dich-vu" },
		{ loc: "/demo" },
		...blogPosts.map((p) => ({
			loc: `/blog/${p.slug}`,
			lastmod: p.updatedAt || p.date || undefined,
		})),
		...seoKnowledgePosts.map((p) => ({
			loc: `/kien-thuc-seo/${p.slug}`,
			lastmod: p.updatedAt || p.date || undefined,
		})),
		...services.map((s) => ({ loc: `/dich-vu/${s.slug}` })),
	];

	const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
	.map((u) => {
		const loc = new URL(u.loc, context.site).toString();
		const lastmod = u.lastmod
			? `\n\t\t<lastmod>${escapeXml(u.lastmod)}</lastmod>`
			: "";
		return `\t<url>\n\t\t<loc>${escapeXml(loc)}</loc>${lastmod}\n\t</url>`;
	})
	.join("\n")}
</urlset>
`;

	return new Response(body, {
		headers: { "content-type": "application/xml; charset=utf-8" },
	});
}
