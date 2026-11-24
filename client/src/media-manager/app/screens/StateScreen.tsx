import { Box, Center, Group, Paper, Stack, Text, Title } from '@mantine/core'
import type { ReactNode } from 'react'
import classes from './StateScreen.module.css'

interface StateScreenProps {
  icon?: ReactNode
  title: ReactNode
  children?: ReactNode
  actions?: ReactNode
  /** Wider card (change lists, onboarding fallback). */
  wide?: boolean
}

/**
 * The full-window screens shown instead of the app: login, server or
 * WordPress unreachable, rejected app password, blocking plugin states.
 * App shortcuts are suspended while one is shown.
 */
export function StateScreen({
  icon,
  title,
  children,
  actions,
  wide,
}: StateScreenProps) {
  return (
    <Center className={classes.screen} data-mm-keymap-suspended=''>
      <Stack gap='lg' w='100%' maw={wide ? 560 : 400} px='md'>
        <Text className={classes.brand} component='div'>
          Media
        </Text>
        <Paper withBorder p='xl' radius='md' className={classes.card}>
          <Stack gap='md'>
            <Group gap='sm' wrap='nowrap' align='center'>
              {icon && (
                <Box className={classes.icon} aria-hidden>
                  {icon}
                </Box>
              )}
              <Title order={1} size='h3'>
                {title}
              </Title>
            </Group>
            {children}
            {actions && (
              <Group gap='sm' justify='flex-start'>
                {actions}
              </Group>
            )}
          </Stack>
        </Paper>
      </Stack>
    </Center>
  )
}

/** A thin indeterminate bar at the top: loading without a spinner (spec §2). */
export function LoadingHairline({ label }: { label: string }) {
  return (
    <div
      className={classes.hairline}
      role='progressbar'
      aria-label={label}
      aria-busy='true'
    >
      <div className={classes.hairlineBar} />
    </div>
  )
}
