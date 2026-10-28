import { replaceSearchParam } from '../../../lib/router.js'

/** Navigation stays independent of the drawer bundle so Home loads details only on demand. */
export function openCardPeek(cardId: string): void {
  replaceSearchParam('card', cardId)
}
