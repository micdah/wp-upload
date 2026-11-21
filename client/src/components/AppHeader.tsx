import { Center, Stack, Title } from '@mantine/core'
import { NyanUnicorn } from './NyanUnicorn'

export function AppHeader() {
  return (
    <Stack gap={4} align='center'>
      <Center>
        <NyanUnicorn size={240} />
      </Center>
      <Title order={1} size='h3' c='neon.3' className='cyber-title'>
        WordPress Media Uploader
      </Title>
    </Stack>
  )
}
