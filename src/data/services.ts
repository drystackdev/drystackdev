import { reader } from "./reader";

export interface Service {
	slug: string;
	icon: "search" | "settings" | "pen-line" | "map-pin";
	title: string;
	price: string;
	desc: string;
	tags: string[];
	hot?: boolean;
	intro: string;
	benefits: string[];
	process: { step: string; desc: string }[];
	metaTitle: string;
	metaDescription: string;
	ogImage: string;
}

export async function getServices(): Promise<Service[]> {
	const entries = await reader.collections.services.all();
	return entries.map(({ slug, entry }) => ({
		slug,
		icon: (entry.icon ?? "search") as Service["icon"],
		title: entry.title,
		price: entry.price,
		desc: entry.desc,
		tags: [...entry.tags],
		hot: entry.hot,
		intro: entry.intro,
		benefits: [...entry.benefits],
		process: entry.process.map((p) => ({ step: p.step, desc: p.desc })),
		metaTitle: entry.metaTitle ?? "",
		metaDescription: entry.metaDescription ?? "",
		ogImage: entry.ogImage ?? "",
	}));
}
