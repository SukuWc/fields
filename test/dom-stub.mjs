// DOM bits boltzmann.js and boat.js touch at import time.
globalThis.document = {
	getElementById: () => ({
		value: '0', selectedIndex: 3, checked: true, innerHTML: '', textContent: '', style: {},
		addEventListener() {}, appendChild() {},
	}),
	getElementsByTagName: () => [],
	createElement: () => ({ addEventListener() {}, appendChild() {}, style: {} }),
	body: { appendChild() {} },
	currentScript: null,
};
globalThis.window = globalThis;
globalThis.addEventListener = globalThis.addEventListener || (() => {});
