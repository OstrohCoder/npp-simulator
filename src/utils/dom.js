const SVG_NS = 'http://www.w3.org/2000/svg'

function apply(node, attributes) {
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'dataset') Object.assign(node.dataset, value)
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value)
    else node.setAttribute(key, value === true ? '' : value)
  }
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue
    node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return node
}

export function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag)
  apply(node, attributes)
  return append(node, children)
}

export function svgEl(tag, attributes = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag)
  apply(node, attributes)
  return append(node, children)
}

export function setText(node, value) {
  if (node.textContent !== value) node.textContent = value
}
