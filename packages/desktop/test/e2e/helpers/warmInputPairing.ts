/** Only for the harness's uninterrupted append stream, verified by exact saved source. */
export function pairAppendedInputs(
  inputs: readonly { data: string, inputType: string, tEvent: number }[],
  transactions: readonly { transaction: number, at: number, insertedUnits?: number, deletedUnits?: number }[]
): readonly number[] | undefined {
  const paired: number[] = []
  let index = 0
  for (const transaction of transactions) {
    let remaining = transaction.insertedUnits
    if (remaining === undefined || !Number.isSafeInteger(remaining) || remaining <= 0 ||
        transaction.deletedUnits !== 0) return undefined
    while (remaining > 0) {
      const input = inputs[index++]
      if (input === undefined || input.inputType !== 'insertText' || input.data.length === 0 ||
          input.tEvent > transaction.at || input.data.length > remaining) return undefined
      remaining -= input.data.length
      paired.push(transaction.transaction)
    }
  }
  return index === inputs.length ? paired : undefined
}
