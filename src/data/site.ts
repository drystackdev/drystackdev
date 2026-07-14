import { reader } from "./reader";

export function getHomepage() {
	return reader.singletons.homepage.readOrThrow();
}

export function getGioiThieuPage() {
	return reader.singletons.gioiThieu.readOrThrow();
}

export function getBlogListingPage() {
	return reader.singletons.blogListing.readOrThrow();
}
