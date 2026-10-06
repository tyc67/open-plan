import { createElement, memo, useMemo } from 'react';
import { furniturePrimitives } from './furnitureSymbols.js';

const FurnitureSymbol = memo(function FurnitureSymbol({type,width,depth,color}) {
  const shapes = useMemo(() => furniturePrimitives(type,width,depth,color),[type,width,depth,color]);
  return <g className="furniture-symbol">{shapes.map(({tag,props},i) => createElement(tag,{...props,key:i}))}</g>;
});
export default FurnitureSymbol;
