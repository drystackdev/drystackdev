import { reader } from "./reader";

export function getHomepage() {
	return reader.singletons.homepage.readOrThrow();
}
