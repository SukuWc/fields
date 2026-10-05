export async function resolve(specifier, context, nextResolve) {
	if (specifier === 'planck-js/dist/planck-with-testbed') {
		return nextResolve(specifier + '.js', context);
	}
	return nextResolve(specifier, context);
}
