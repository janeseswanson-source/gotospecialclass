import { SetupProvider } from '@/contexts/SetupContext';
import SetupWizardContent from './SetupWizardContent';

const SetupPage = () => {
  return (
    <SetupProvider>
      <SetupWizardContent />
    </SetupProvider>
  );
};

export default SetupPage;
