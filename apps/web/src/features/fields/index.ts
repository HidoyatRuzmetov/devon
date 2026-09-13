// The public entry of the `fields` feature -- what another feature imports.
//
// Everything else in this directory is private to the feature, the same convention `packages/ui`'s
// own `index.ts` documents. Three of these are the cross-feature surfaces v1.1 SPEC §5 asks for and
// this package cannot wire up itself (its brief restricts it to `features/fields`, `features/accounts`
// and the contracts/db/i18n it owns). Each is finished and already exercised in the browser; the
// merge adds one import line at the host:
//
//   * `CardCustomFields` -> `features/work/components/card-detail.tsx`, in the property column:
//         <CardCustomFields cardId={card.id} ownerUserIds={card.ownerUserIds} />
//   * `MyFieldsSection`  -> already wired, into `features/accounts/account-settings-screen.tsx`.
//   * `useFieldColumns`  -> `features/people/people-table-screen.tsx`, to add every person field with
//     `showInTable` as a column beside the indicator registry's:
//         const fieldColumns = useFieldColumns(memberUserIds)
//   * `FieldValueDisplay` renders one answer anywhere (a table cell, a person page chip row).
export { CardCustomFields, type CardCustomFieldsProps } from './components/card-custom-fields.js'
export { MyFieldsSection } from './components/my-fields-section.js'
export {
  FieldValueDisplay,
  FieldValueInput,
  checkValue,
  type FieldValueInputProps,
} from './components/field-value-input.js'
export { useFieldColumns, type FieldColumn } from './use-field-columns.js'
export {
  fieldDescription,
  fieldLabel,
  formatFieldValue,
  isMissing,
  optionLabel,
  optionTone,
  selectedOptions,
} from './format.js'
export {
  fetchDefs,
  fetchValues,
  setValue,
  type FieldDefDto,
  type FieldValueRecordDto,
  type WireFieldValue,
} from './api.js'
