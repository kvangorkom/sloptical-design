// The optics engine for Node: `const Optics = require('./src/engine')`.
//
// The engine is a set of plain scripts that each add their functions to one shared `Optics` object. In the browser they
// are loaded with <script> tags in this order and share `globalThis.Optics`; in Node each file requires the one before
// it, so requiring the last loads them all. Load order:
//   vector → conic → trace → analysis → solves → edit → zemax → python → configs → shapes

module.exports = require('./shapes.js');
