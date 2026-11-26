// Mantine's notifications container, in its own lazy chunk (plan §9's
// initial-chunk budget): its component, transitions and styles are about
// 10 kB gzip and are only needed once a toast shows. `toast()` talks to
// Mantine's notifications store, which is tiny and loaded with core/ui; a
// toast raised before this chunk arrives is shown once it mounts.

import '@mantine/core/styles/Notification.layer.css'
import '@mantine/notifications/styles.layer.css'
import { Notifications } from '@mantine/notifications'

export default function NotificationsHost() {
  return <Notifications position='bottom-right' />
}
