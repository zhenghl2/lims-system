"""Smoke tests for LIMS core models."""
from django.test import TestCase
from django.utils import timezone


class SampleModelSmokeTest(TestCase):
    """Verify core Sample model integrity."""

    @classmethod
    def setUpTestData(cls):
        from lims.apps.samples.models import SampleType, TestPanel
        cls.sample_type = SampleType.objects.create(code="BLOOD", name="Blood")
        cls.panel = TestPanel.objects.create(code="NIPT", name="NIPT Basic")

    def test_create_sample(self):
        """Sample creation sets default status to REGISTERED."""
        from lims.apps.samples.models import Sample
        s = Sample.objects.create(
            sample_id="SMP-TEST-001",
            sample_type=self.sample_type,
            panel=self.panel,
            collection_date=timezone.now().date(),
            receipt_date=timezone.now().date(),
            receipt_time=timezone.now().time(),
        )
        self.assertEqual(s.status, "REGISTERED")
        self.assertEqual(str(s.sample_id), "SMP-TEST-001")

    def test_sample_str(self):
        """Sample string representation includes sample_id."""
        from lims.apps.samples.models import Sample
        s = Sample.objects.create(
            sample_id="SMP-TEST-002",
            sample_type=self.sample_type,
            panel=self.panel,
            collection_date=timezone.now().date(),
            receipt_date=timezone.now().date(),
            receipt_time=timezone.now().time(),
        )
        self.assertIn("SMP-TEST-002", str(s))
