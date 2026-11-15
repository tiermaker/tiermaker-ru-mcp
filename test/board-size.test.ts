import { expect, it } from 'vitest'
import { BoardStore, addItems } from '../src/board.js'

it('rejects oversized image URLs on successive edits without accumulating them', () => {
  const store = new BoardStore()
  const board = store.create('Bounded board')
  addItems(board, [{ label:'Existing' }])
  const url = 'https://images.example/a#' + 'x'.repeat(10000)
  for (let i=0; i<3; i++) expect(() => addItems(board, [{ image_url:url }])).toThrow(/URL.*long|URL.*limit/i)
  expect(board.items.map(item => item.label)).toEqual(['Existing'])
})
