import { useNavigate, useParams } from 'react-router-dom';
import { Box, Flex, Typography, Button } from '@strapi/design-system';
import { ArrowRight, ArrowLeft, Check } from '@strapi/icons';
import { ConfigTab } from './ConfigTab';
import { ContentTypesTab } from './ContentTypesTab';
import { SyncTab } from './SyncTab';
import { resolvePath } from '../nav';

// The Connect step only needs the connection form — enforcement and alerts are
// advanced concerns kept out of the guided first-run (progressive disclosure).
const ConnectStep = () => <ConfigTab only={['connection']} />;

// Ordered steps of the guided first-run. Each step is its own URL
// (/setup/connect, /setup/scope, /setup/run) so progress is deep-linkable and
// the back button moves between steps.
const STEPS = [
    {
        key: 'connect',
        label: 'Connect',
        title: 'Connect to your remote server',
        hint: 'Enter the remote Strapi URL and an API token. You can generate a token from here if you have admin credentials. Enforcement and alerts are optional — set them later under Configure → Advanced.',
        Component: ConnectStep,
    },
    {
        key: 'scope',
        label: 'Choose scope',
        title: 'Choose what to sync',
        hint: 'Toggle on the content types you want to keep in sync. Default profiles are created automatically.',
        Component: ContentTypesTab,
    },
    {
        key: 'run',
        label: 'Run',
        title: 'Run your first sync',
        hint: 'Review active profiles and run them. Come back any time to schedule periodic runs.',
        Component: SyncTab,
    },
];

const Stepper = ({ current }) => (
    <Flex gap={2} alignItems="center" wrap="wrap">
        {STEPS.map((step, i) => {
            const isCurrent = i === current;
            const isDone = i < current;
            return (
                <Flex key={step.key} gap={2} alignItems="center">
                    <Flex
                        alignItems="center"
                        justifyContent="center"
                        width="1.75rem"
                        height="1.75rem"
                        hasRadius
                        background={isCurrent ? 'primary600' : isDone ? 'success500' : 'neutral200'}
                    >
                        {isDone ? (
                            <Check width="0.75rem" height="0.75rem" fill="neutral0" />
                        ) : (
                            <Typography
                                variant="pi"
                                fontWeight="bold"
                                textColor={isCurrent ? 'neutral0' : 'neutral600'}
                            >
                                {i + 1}
                            </Typography>
                        )}
                    </Flex>
                    <Typography
                        variant="omega"
                        fontWeight={isCurrent ? 'bold' : 'regular'}
                        textColor={isCurrent ? 'neutral800' : 'neutral600'}
                    >
                        {step.label}
                    </Typography>
                    {i < STEPS.length - 1 && (
                        <Box paddingLeft={2} paddingRight={2}>
                            <ArrowRight width="0.75rem" height="0.75rem" fill="neutral400" />
                        </Box>
                    )}
                </Flex>
            );
        })}
    </Flex>
);

const SetupWizard = () => {
    const navigate = useNavigate();
    const { step: stepParam } = useParams();

    const currentIndex = Math.max(
        0,
        STEPS.findIndex((s) => s.key === (stepParam || 'connect'))
    );
    const current = STEPS[currentIndex] ?? STEPS[0];
    const Screen = current.Component;

    const goTo = (i) => {
        if (i < 0 || i >= STEPS.length) {
            navigate(resolvePath('sync'));
            return;
        }
        navigate(resolvePath(`setup/${STEPS[i].key}`));
    };

    const isLast = currentIndex === STEPS.length - 1;

    return (
        <Box>
            <Box marginBottom={5}>
                <Stepper current={currentIndex} />
            </Box>

            <Box
                padding={5}
                marginBottom={5}
                background="primary100"
                hasRadius
                borderColor="primary200"
                borderStyle="solid"
                borderWidth="1px"
            >
                <Typography variant="beta" tag="h2">
                    {current.title}
                </Typography>
                <Box paddingTop={2} maxWidth="52rem">
                    <Typography variant="omega" textColor="neutral700">
                        {current.hint}
                    </Typography>
                </Box>
            </Box>

            {/* The step's screen. We reuse the existing full-featured tabs so all
                functionality is available inside the guided flow. */}
            <Box marginBottom={6}>
                <Screen />
            </Box>

            <Flex justifyContent="space-between" alignItems="center">
                <Button
                    variant="tertiary"
                    startIcon={<ArrowLeft />}
                    disabled={currentIndex === 0}
                    onClick={() => goTo(currentIndex - 1)}
                >
                    Back
                </Button>
                <Button
                    endIcon={isLast ? <Check /> : <ArrowRight />}
                    onClick={() => goTo(currentIndex + 1)}
                >
                    {isLast ? 'Finish' : `Next: ${STEPS[currentIndex + 1].label}`}
                </Button>
            </Flex>
        </Box>
    );
};

export { SetupWizard };
export default SetupWizard;
