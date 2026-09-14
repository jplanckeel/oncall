import React, { createRef, useRef } from 'react';

/**
 * React 19 removed `ReactDOM.findDOMNode`, which `react-transition-group@4` falls back on whenever a
 * `<Transition>` / `<CSSTransition>` is rendered without a `nodeRef` prop. Under Grafana 12.3 (React 19) this
 * throws `TypeError: findDOMNode is not a function` from `performEnter` / `performExit` and takes the whole
 * subtree down with it.
 *
 * Every `<CSSTransition>` must therefore be handed a stable ref, and — per react-transition-group's docs — a
 * *distinct* ref per `key` when rendered inside a `<TransitionGroup>`. This registry hands out one memoized ref
 * per key so both requirements hold across re-renders.
 *
 * The element the ref points at must be the one the transition classes are applied to, so the child of the
 * `<CSSTransition>` has to forward it down to its root DOM node (see `Rotation`'s / `Tag`'s `forwardedRef` prop).
 */
export class NodeRefRegistry {
  private refs = new Map<string, React.RefObject<HTMLElement>>();

  get<T extends HTMLElement = HTMLElement>(key: string | number): React.RefObject<T> {
    const mapKey = String(key);
    let ref = this.refs.get(mapKey);

    if (!ref) {
      ref = createRef<HTMLElement>();
      this.refs.set(mapKey, ref);
    }

    return ref as React.RefObject<T>;
  }
}

/** `NodeRefRegistry` for function components. Class components can hold one as an instance field instead. */
export const useNodeRefRegistry = (): NodeRefRegistry => useRef(new NodeRefRegistry()).current;

/**
 * Fans one DOM node out to several refs. Needed whenever a single element has to be tracked by more than one
 * library at once — e.g. a row that is both a dnd-kit sortable (`setNodeRef`) and a react-transition-group
 * child (`nodeRef`).
 */
export const mergeRefs =
  <T extends HTMLElement>(...refs: Array<React.Ref<T> | undefined>): React.RefCallback<T> =>
  (node) => {
    refs.forEach((ref) => {
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        (ref as React.MutableRefObject<T>).current = node;
      }
    });
  };
