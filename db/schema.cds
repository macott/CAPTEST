namespace BASTEST;

using sap.workflow from './WorkflowObject';

entity TEST
{
    key ID : UUID
        @Core.Computed;
}

entity TEST2
{
    key ID : UUID
        @Core.Computed;
    TEST : String(100);
}
