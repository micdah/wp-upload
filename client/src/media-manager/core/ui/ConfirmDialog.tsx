// The confirm dialog itself (see confirm.tsx), a lazy chunk: Mantine's Modal
// brings ScrollArea, a focus trap and scroll lock, which the initial chunk
// shouldn't pay for (D31).

import { Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core'
import { useState } from 'react'
import { type ConfirmRequest, settleConfirm } from './confirm'

/** The open confirm request as a Mantine Modal. */
export default function ConfirmDialog({
  request,
}: {
  request: ConfirmRequest
}) {
  const { options } = request
  const [typed, setTyped] = useState('')
  const needsTyping = options.typeToConfirm !== undefined
  const typedOk = !needsTyping || typed.trim() === options.typeToConfirm
  const danger = options.tone === 'danger'
  return (
    <Modal
      opened
      onClose={() => settleConfirm(request.id, false)}
      title={options.title}
      centered
      closeButtonProps={{ 'aria-label': 'Cancel' }}
      data-mm-confirm=''
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (typedOk) {
            settleConfirm(request.id, true)
          }
        }}
      >
        <Stack gap='md'>
          {options.body !== undefined &&
            (typeof options.body === 'string' ? (
              <Text size='sm'>{options.body}</Text>
            ) : (
              options.body
            ))}
          {needsTyping && (
            <TextInput
              label={
                options.typeToConfirmLabel ?? (
                  <>
                    Type <strong>{options.typeToConfirm}</strong> to confirm
                  </>
                )
              }
              value={typed}
              onChange={(event) => setTyped(event.currentTarget.value)}
              autoComplete='off'
              data-autofocus
            />
          )}
          <Group justify='flex-end' gap='sm'>
            <Button
              type='button'
              variant='default'
              onClick={() => settleConfirm(request.id, false)}
              data-autofocus={danger && !needsTyping ? true : undefined}
            >
              {options.cancelLabel ?? 'Cancel'}
            </Button>
            <Button
              type='submit'
              color={danger ? 'red' : undefined}
              disabled={!typedOk}
              data-autofocus={!danger && !needsTyping ? true : undefined}
            >
              {options.confirmLabel ?? 'Confirm'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}
