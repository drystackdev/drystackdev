import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { getBlogPosts, getSeoKnowledgePosts } from "../data/blog";

export async function GET(context: APIContext) {
	const [blogPosts, seoKnowledgePosts] = await Promise.all([
		getBlogPosts(),
		getSeoKnowledgePosts(),
	]);
	const items = [
		...blogPosts.map((p) => ({ ...p, basePath: "/blog" })),
		...seoKnowledgePosts.map((p) => ({ ...p, basePath: "/kien-thuc-seo" })),
	].sort((a, b) => b.date.localeCompare(a.date));

	return rss({
		title: "QuangSEO | Bài viết & Kiến thức SEO",
		description:
			"Kiến thức, hướng dẫn và cập nhật SEO mới nhất từ Nguyễn Phương Quang.",
		site: context.site!,
		items: items.map((p) => ({
			title: p.title,
			description: p.excerpt,
			pubDate: new Date(p.date),
			link: `${p.basePath}/${p.slug}`,
		})),
	});
}
