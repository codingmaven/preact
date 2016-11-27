import { ATTR_KEY } from '../constants';
import { isString, isFunction } from '../util';
import { isSameNodeType, isNamedNode } from './index';
import { isFunctionalComponent, buildFunctionalComponent } from './functional-component';
import { buildComponentFromVNode } from './component';
import { setAccessor } from '../dom/index';
import { createNode, collectNode } from '../dom/recycler';
import { unmountComponent } from './component';
import options from '../options';


/** Diff recursion count, used to track the end of the diff cycle. */
export const mounts = [];

/** Diff recursion count, used to track the end of the diff cycle. */
export let diffLevel = 0;

let isSvgMode = false;

let hydrating = false;


export function flushMounts() {
	let c;
	while ((c=mounts.pop())) {
		if (options.afterMount) options.afterMount(c);
		if (c.componentDidMount) c.componentDidMount();
	}
}


/** Apply differences in a given vnode (and it's deep children) to a real DOM Node.
 *	@param {Element} [dom=null]		A DOM node to mutate into the shape of the `vnode`
 *	@param {VNode} vnode			A VNode (with descendants forming a tree) representing the desired DOM structure
 *	@returns {Element} dom			The created/mutated element
 *	@private
 */
export function diff(dom, vnode, context, mountAll, parent, componentRoot) {
	if (!diffLevel++) {
		isSvgMode = parent instanceof SVGElement;
		hydrating = dom && !(ATTR_KEY in dom);
	}
	let ret = idiff(dom, vnode, context, mountAll);
	if (parent && ret.parentNode!==parent) parent.appendChild(ret);
	if (!--diffLevel) {
		hydrating = false;
		if (!componentRoot) flushMounts();
	}
	return ret;
}


function idiff(dom, vnode, context, mountAll) {
	let originalAttributes = vnode && vnode.attributes;

	while (isFunctionalComponent(vnode)) {
		vnode = buildFunctionalComponent(vnode, context);
	}

	if (vnode==null) vnode = '';

	if (isString(vnode)) {
		if (dom && dom instanceof Text) {
			if (dom.nodeValue!=vnode) {
				dom.nodeValue = vnode;
			}
		}
		else {
			if (dom) recollectNodeTree(dom);
			dom = document.createTextNode(vnode);
		}
		dom[ATTR_KEY] = true;
		return dom;

	}

	if (isFunction(vnode.nodeName)) {
		return buildComponentFromVNode(dom, vnode, context, mountAll);
	}

	let out = dom,
		nodeName = String(vnode.nodeName),
		prevSvgMode = isSvgMode,
		vchildren = vnode.children;


	isSvgMode = nodeName==='svg' ? true : nodeName==='foreignObject' ? false : isSvgMode;

	if (!dom) {
		out = createNode(nodeName, isSvgMode);
	}
	else if (!isNamedNode(dom, nodeName)) {
		out = createNode(nodeName, isSvgMode);
		// move children into the replacement node
		while (dom.firstChild) out.appendChild(dom.firstChild);
		// reclaim element nodes
		if (dom.parentNode) dom.parentNode.replaceChild(out, dom);
		recollectNodeTree(dom);
	}


	let fc = out.firstChild,
		props = out[ATTR_KEY];
	if (!props) {
		out[ATTR_KEY] = props = {};
		for (let a=out.attributes, i=a.length; i--; ) props[a[i].name] = a[i].value;
	}

	diffAttributes(out, vnode.attributes, props);


	// fast-path for elements containing a single TextNode:
	if (!hydrating && vchildren && vchildren.length===1 && typeof vchildren[0]==='string' && fc instanceof Text && !fc.nextSibling) {
		if (fc.nodeValue!=vchildren[0]) {
			fc.nodeValue = vchildren[0];
		}
	}
	else if (vchildren && vchildren.length || fc) {
		innerDiffNode(out, vchildren, context, mountAll);
	}

	if (originalAttributes && typeof originalAttributes.ref==='function') {
		(props.ref = originalAttributes.ref)(out);
	}

	isSvgMode = prevSvgMode;

	return out;
}


/** Apply child and attribute changes between a VNode and a DOM Node to the DOM. */
function innerDiffNode(dom, vchildren, context, mountAll) {
	let originalChildren = dom.childNodes,
		children = [],
		keyed = {},
		keyedLen = 0,
		min = 0,
		len = originalChildren.length,
		childrenLen = 0,
		vlen = vchildren && vchildren.length,
		j, c, vchild, child;

	if (len) {
		for (let i=0; i<len; i++) {
			let child = originalChildren[i],
				props = child[ATTR_KEY],
				key = vlen ? ((c = child._component) ? c.__key : props ? props.key : null) : null;
			if (key!=null) {
				keyedLen++;
				keyed[key] = child;
			}
			else if (hydrating || props) {
				children[childrenLen++] = child;
			}
		}
	}

	if (vlen) {
		for (let i=0; i<vlen; i++) {
			vchild = vchildren[i];
			child = null;

			// if (isFunctionalComponent(vchild)) {
			// 	vchild = buildFunctionalComponent(vchild);
			// }

			// attempt to find a node based on key matching
			let key = vchild.key;
			if (key!=null) {
				if (keyedLen && key in keyed) {
					child = keyed[key];
					keyed[key] = undefined;
					keyedLen--;
				}
			}
			// attempt to pluck a node of the same type from the existing children
			else if (!child && min<childrenLen) {
				for (j=min; j<childrenLen; j++) {
					c = children[j];
					if (c && isSameNodeType(c, vchild)) {
						child = c;
						children[j] = undefined;
						if (j===childrenLen-1) childrenLen--;
						if (j===min) min++;
						break;
					}
				}
				if (!child && min<childrenLen && isFunction(vchild.nodeName) && mountAll) {
					child = children[min];
					children[min++] = undefined;
				}
			}

			// morph the matched/found/created DOM child to match vchild (deep)
			child = idiff(child, vchild, context, mountAll);

			if (child && child!==dom) {
				if (i>=len) {
					dom.appendChild(child);
				}
				else if (child!==originalChildren[i]) {
					dom.insertBefore(child, originalChildren[i] || null);
				}
			}
		}
	}


	if (keyedLen) {
		for (let i in keyed) if (keyed[i]) recollectNodeTree(keyed[i]);
	}

	// remove orphaned children
	if (min<childrenLen) {
		removeOrphanedChildren(children);
	}
}


/** Reclaim children that were unreferenced in the desired VTree */
export function removeOrphanedChildren(children, unmountOnly) {
	for (let i=children.length; i--; ) {
		if (children[i]) {
			recollectNodeTree(children[i], unmountOnly);
		}
	}
}


/** Reclaim an entire tree of nodes, starting at the root. */
export function recollectNodeTree(node, unmountOnly) {
	// @TODO: Need to make a call on whether Preact should remove nodes not created by itself.
	// Currently it *does* remove them. Discussion: https://github.com/developit/preact/issues/39
	//if (!node[ATTR_KEY]) return;

	let component = node._component;
	if (component) {
		unmountComponent(component, !unmountOnly);
	}
	else {
		if (node[ATTR_KEY] && node[ATTR_KEY].ref) node[ATTR_KEY].ref(null);

		if (!unmountOnly) {
			collectNode(node);
		}

		if (node.childNodes && node.childNodes.length) {
			removeOrphanedChildren(node.childNodes, unmountOnly);
		}
	}
}


/** Apply differences in attributes from a VNode to the given DOM Node. */
function diffAttributes(dom, attrs, old) {
	for (let name in old) {
		if (!(attrs && name in attrs) && old[name]!=null) {
			setAccessor(dom, name, old[name], old[name] = undefined, isSvgMode);
		}
	}

	// new & updated
	if (attrs) {
		for (let name in attrs) {
			if (name!=='children' && name!=='innerHTML' && (!(name in old) || attrs[name]!==(name==='value' || name==='checked' ? dom[name] : old[name]))) {
				setAccessor(dom, name, old[name], old[name] = attrs[name], isSvgMode);
			}
		}
	}
}
