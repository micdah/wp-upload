// Mantine's CSS, per component (D31), instead of the global
// `@mantine/core/styles.css`: the whole stylesheet was the largest part of
// the initial media-manager chunk (36.8 kB gzip), and the app uses a fraction
// of Mantine's components.
//
// Every file is the `.layer.css` variant, which wraps its rules in
// `@layer mantine`. Unlayered CSS always wins over a layer, whatever the load
// order, so theme.css and the app's CSS modules override Mantine reliably,
// and a lazily loaded feature can add a component's CSS later without
// undoing our overrides.
//
// Using a Mantine component that isn't listed here? Import its layer file
// next to where you use it, e.g. in a feature:
//
//     import '@mantine/core/styles/Slider.layer.css'
//
// Some components need others' styles too (Mantine's docs list them): a
// Modal needs ModalBase, Overlay and CloseButton; anything clickable needs
// UnstyledButton; inputs need Input. The baseline, the default CSS
// variables and the global styles come first, always.

import '@mantine/core/styles/baseline.layer.css'
import '@mantine/core/styles/default-css-variables.layer.css'
import '@mantine/core/styles/global.layer.css'

// Layout and typography.
import '@mantine/core/styles/Center.layer.css'
import '@mantine/core/styles/Group.layer.css'
import '@mantine/core/styles/Stack.layer.css'
import '@mantine/core/styles/Paper.layer.css'
import '@mantine/core/styles/Text.layer.css'
import '@mantine/core/styles/Title.layer.css'
import '@mantine/core/styles/Anchor.layer.css'
import '@mantine/core/styles/List.layer.css'
import '@mantine/core/styles/Kbd.layer.css'
import '@mantine/core/styles/VisuallyHidden.layer.css'

// Buttons.
import '@mantine/core/styles/UnstyledButton.layer.css'
import '@mantine/core/styles/Button.layer.css'
import '@mantine/core/styles/ActionIcon.layer.css'
import '@mantine/core/styles/CloseButton.layer.css'
import '@mantine/core/styles/Loader.layer.css'

// Inputs (TextInput, Textarea, PasswordInput).
import '@mantine/core/styles/Input.layer.css'
import '@mantine/core/styles/PasswordInput.layer.css'

// Floating and overlay surfaces.
import '@mantine/core/styles/Popover.layer.css'
import '@mantine/core/styles/Menu.layer.css'
import '@mantine/core/styles/Tooltip.layer.css'
import '@mantine/core/styles/Overlay.layer.css'
import '@mantine/core/styles/ModalBase.layer.css'
import '@mantine/core/styles/Modal.layer.css'

// Feedback. Notification styles load with the toasts' lazy container
// (app/NotificationsHost.tsx).
import '@mantine/core/styles/Alert.layer.css'
