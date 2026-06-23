"""Minimal CI smoke test - no model dependencies."""
from django.test import TestCase


class TrivialTest(TestCase):
    def test_always_pass(self):
        self.assertEqual(1 + 1, 2)

    def test_django_configured(self):
        from django.conf import settings
        self.assertTrue(settings.DEBUG is False)
