import { SVG_NAMESPACE } from '../constants';
import { toLowerCase } from '../util';
import { removeNode } from './index';

/** DOM node pool, keyed on nodeName. */

const nodes = {};

export function collectNode(node) {
	removeNode(node);

	if (node instanceof Element) {
		node._component = node._componentConstructor = null;

		let name = node.normalizedNodeName || toLowerCase(node.nodeName);
		(nodes[name] || (nodes[name] = [])).push(node);
	}
}


export function createNode(nodeName, isSvg) {
	let name = toLowerCase(nodeName),
		node = nodes[name] && nodes[name].pop() || (isSvg ? document.createElementNS(SVG_NAMESPACE, nodeName) : document.createElement(nodeName));
	node.normalizedNodeName = name;
	return node;
}
