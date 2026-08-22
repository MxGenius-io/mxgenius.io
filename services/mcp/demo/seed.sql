-- MXGenius complete demonstration dataset.
-- Loaded only by the authenticated administrator endpoint. All records are
-- fictional, visibly labeled, and scoped to the caller's organization.

DO $$
DECLARE
    demo_org uuid := current_setting('mxgenius.demo_org')::uuid;
    demo_actor uuid := current_setting('mxgenius.demo_actor')::uuid;
BEGIN
    INSERT INTO aircraft_canonical (
        id, organization_id, aircraft_id, source_system, source_id, make, model,
        year, registration, serial_number, base_icao, base_iata, base_city,
        base_country, metadata, source_hash, freshness_at, updated_at
    ) VALUES (
        'd0000000-0000-4000-8000-000000000001', demo_org, 'MXG-DEMO-N350MX',
        'demo', 'demo-aircraft-1', 'Bombardier', 'Challenger 350', 2022,
        'N350MX', 'DEMO-350-001', 'KDAL', 'DAL', 'Dallas', 'US',
        jsonb_build_object(
            'dataset', 'mxgenius_complete_demo', 'demo', true,
            'label', 'DEMO AIRCRAFT — NOT A REAL REGISTRATION',
            'airframe_hours', 1842.6, 'airframe_cycles', 1297,
            'owner', 'MXG Demo Aviation LLC', 'operator', 'MXG Demo Flight Department'
        ),
        'demo-aircraft-source-hash', now(), now()
    ) ON CONFLICT (organization_id, aircraft_id) DO UPDATE SET
        metadata=EXCLUDED.metadata, freshness_at=EXCLUDED.freshness_at,
        updated_at=EXCLUDED.updated_at;

    INSERT INTO maintenance_cases (
        case_id, organization_id, aircraft_id, status, priority, opened_at,
        updated_at, location, raw_discrepancy, normalized_discrepancy,
        assigned_user_ids, evidence_ids, approval_state, version
    ) VALUES
    (
        'd0000000-0000-4000-8000-000000000101', demo_org, 'MXG-DEMO-N350MX',
        'awaiting_parts', 'aog', now() - interval '9 hours', now() - interval '35 minutes',
        '{"icao":"KDAL","facility":"Demo Hangar 2"}'::jsonb,
        '[DEMO] Hydraulic system B pressure decays after engine shutdown.',
        '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"29","symptom":"hydraulic pressure decay","component_id":"MXG-DEMO-HYD-PUMP-B"}'::jsonb,
        ARRAY[demo_actor],
        ARRAY['d0000000-0000-4000-8000-000000000501'::uuid,'d0000000-0000-4000-8000-000000000502'::uuid],
        'pending', 3
    ),
    (
        'd0000000-0000-4000-8000-000000000102', demo_org, 'MXG-DEMO-N350MX',
        'closed', 'urgent', now() - interval '45 days', now() - interval '44 days 18 hours',
        '{"icao":"KDAL","facility":"Demo Hangar 2"}'::jsonb,
        '[DEMO] Hydraulic system B pressure decays after engine shutdown.',
        '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"29","symptom":"hydraulic pressure decay","component_id":"MXG-DEMO-HYD-PUMP-B","resolution":"replaced pressure switch"}'::jsonb,
        ARRAY[demo_actor], ARRAY['d0000000-0000-4000-8000-000000000503'::uuid],
        'approved', 5
    ),
    (
        'd0000000-0000-4000-8000-000000000103', demo_org, 'MXG-DEMO-N350MX',
        'scheduled', 'routine', now() - interval '3 days', now() - interval '2 hours',
        '{"icao":"KDAL","facility":"Demo Hangar 1"}'::jsonb,
        '[DEMO] Cabin air filter replacement due at next maintenance opportunity.',
        '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"21","symptom":"scheduled cabin air filter replacement","component_id":"MXG-DEMO-CABIN-FILTER"}'::jsonb,
        ARRAY[demo_actor], ARRAY['d0000000-0000-4000-8000-000000000504'::uuid],
        'not_required', 2
    ),
    (
        'd0000000-0000-4000-8000-000000000104', demo_org, 'MXG-DEMO-N350MX',
        'closed', 'routine', now() - interval '120 days', now() - interval '119 days 20 hours',
        '{"icao":"KDAL","facility":"Demo Hangar 1"}'::jsonb,
        '[DEMO] Hydraulic system B pressure decays after engine shutdown.',
        '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"29","symptom":"hydraulic pressure decay","component_id":"MXG-DEMO-HYD-PUMP-B","resolution":"serviced reservoir"}'::jsonb,
        ARRAY[demo_actor], ARRAY[]::uuid[], 'approved', 4
    )
    ON CONFLICT (case_id) DO UPDATE SET
        status=EXCLUDED.status, priority=EXCLUDED.priority,
        updated_at=EXCLUDED.updated_at, location=EXCLUDED.location,
        raw_discrepancy=EXCLUDED.raw_discrepancy,
        normalized_discrepancy=EXCLUDED.normalized_discrepancy,
        assigned_user_ids=EXCLUDED.assigned_user_ids,
        evidence_ids=EXCLUDED.evidence_ids,
        approval_state=EXCLUDED.approval_state, version=EXCLUDED.version;

    INSERT INTO discrepancies (id, organization_id, case_id, normalized_summary, raw) VALUES
        ('d0000000-0000-4000-8000-000000000201', demo_org, 'd0000000-0000-4000-8000-000000000101', 'ATA 29 hydraulic pressure decay', '[DEMO] Hydraulic system B pressure decays after engine shutdown.'),
        ('d0000000-0000-4000-8000-000000000202', demo_org, 'd0000000-0000-4000-8000-000000000103', 'ATA 21 cabin air filter due', '[DEMO] Cabin air filter replacement due.')
    ON CONFLICT (id) DO UPDATE SET normalized_summary=EXCLUDED.normalized_summary, raw=EXCLUDED.raw;

    INSERT INTO maintenance_events (id, organization_id, case_id, from_status, to_status, actor_user_id, reason, created_at) VALUES
        ('d0000000-0000-4000-8000-000000000211', demo_org, 'd0000000-0000-4000-8000-000000000101', 'triage', 'diagnosing', demo_actor, '[DEMO] Fault isolated to hydraulic pump circuit.', now() - interval '7 hours'),
        ('d0000000-0000-4000-8000-000000000212', demo_org, 'd0000000-0000-4000-8000-000000000101', 'diagnosing', 'awaiting_parts', demo_actor, '[DEMO] Replacement pump requested.', now() - interval '5 hours'),
        ('d0000000-0000-4000-8000-000000000213', demo_org, 'd0000000-0000-4000-8000-000000000102', 'awaiting_inspection', 'closed', demo_actor, '[DEMO] Inspection complete and record approved.', now() - interval '44 days 18 hours')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO observations (id, organization_id, case_id, note, component_id, author_user_id, media_refs, created_at) VALUES
        ('d0000000-0000-4000-8000-000000000221', demo_org, 'd0000000-0000-4000-8000-000000000101', '[DEMO] Pressure fell from 3000 PSI to 2100 PSI over ten minutes.', 'MXG-DEMO-HYD-PUMP-B', demo_actor, '[{"kind":"demo_photo","label":"Hydraulic bay overview — demonstration placeholder"}]'::jsonb, now() - interval '6 hours'),
        ('d0000000-0000-4000-8000-000000000222', demo_org, 'd0000000-0000-4000-8000-000000000103', '[DEMO] Filter indicator shows replacement due.', 'MXG-DEMO-CABIN-FILTER', demo_actor, '[]'::jsonb, now() - interval '1 day')
    ON CONFLICT (id) DO UPDATE SET note=EXCLUDED.note, media_refs=EXCLUDED.media_refs;

    INSERT INTO case_assignments (organization_id, case_id, user_id) VALUES
        (demo_org, 'd0000000-0000-4000-8000-000000000101', demo_actor),
        (demo_org, 'd0000000-0000-4000-8000-000000000103', demo_actor)
    ON CONFLICT DO NOTHING;

    INSERT INTO components (id, aircraft_id, ata, name, metadata) VALUES
        ('d0000000-0000-4000-8000-000000000301', 'MXG-DEMO-N350MX', '29', 'Hydraulic Pump B', '{"dataset":"mxgenius_complete_demo","demo":true,"component_id":"MXG-DEMO-HYD-PUMP-B","zone":"right_aft_equipment_bay","status":"suspect"}'::jsonb),
        ('d0000000-0000-4000-8000-000000000302', 'MXG-DEMO-N350MX', '21', 'Cabin Air Filter', '{"dataset":"mxgenius_complete_demo","demo":true,"component_id":"MXG-DEMO-CABIN-FILTER","zone":"environmental_control_bay","status":"service_due"}'::jsonb)
    ON CONFLICT (id) DO UPDATE SET metadata=EXCLUDED.metadata;

    INSERT INTO technical_documents (id, organization_id, title, doc_type) VALUES
        ('d0000000-0000-4000-8000-000000000401', demo_org, '[DEMO] Challenger 350 Hydraulic System Maintenance Excerpt', 'maintenance_manual'),
        ('d0000000-0000-4000-8000-000000000402', demo_org, '[DEMO] Parts Receiving and Traceability Procedure', 'company_procedure')
    ON CONFLICT (organization_id, id) DO UPDATE SET title=EXCLUDED.title, doc_type=EXCLUDED.doc_type;

    INSERT INTO document_revisions (id, document_id, revision, effective_date, uploaded_by, sha256) VALUES
        ('d0000000-0000-4000-8000-000000000411', 'd0000000-0000-4000-8000-000000000401', 'DEMO-1', current_date - 30, demo_actor, repeat('a',64)),
        ('d0000000-0000-4000-8000-000000000412', 'd0000000-0000-4000-8000-000000000402', 'DEMO-2', current_date - 15, demo_actor, repeat('b',64))
    ON CONFLICT (document_id, revision) DO UPDATE SET effective_date=EXCLUDED.effective_date, sha256=EXCLUDED.sha256;

    INSERT INTO regulatory_requirements (id, source_reference, document_id, summary) VALUES
        ('d0000000-0000-4000-8000-000000000421', 'demo://faa/ad/DEMO-2026-01', 'd0000000-0000-4000-8000-000000000401', '[DEMO ONLY] Inspect the fictional hydraulic pressure switch installation.')
    ON CONFLICT (id) DO UPDATE SET summary=EXCLUDED.summary;

    INSERT INTO case_regulatory_links (case_id, requirement_id) VALUES
        ('d0000000-0000-4000-8000-000000000101', 'd0000000-0000-4000-8000-000000000421')
    ON CONFLICT DO NOTHING;

    INSERT INTO evidence (
        id, organization_id, source_type, source_reference, kind, title, excerpt,
        retrieved_at, effective_at, revision, license_scope, content_hash, content
    ) VALUES
        ('d0000000-0000-4000-8000-000000000501', demo_org, 'demo', 'demo://manual/hydraulic/29-10', 'manual_excerpt', '[DEMO] Hydraulic Pump Fault Isolation', 'Demonstration procedure: verify pressure decay, inspect switch wiring, and record findings.', now() - interval '6 hours', now() - interval '30 days', 'DEMO-1', 'fictional-demo-only', repeat('1',64), 'Fictional demonstration content. Not approved maintenance data.'),
        ('d0000000-0000-4000-8000-000000000502', demo_org, 'demo', 'demo://inspection/hydraulic-photo', 'inspection_observation', '[DEMO] Hydraulic Bay Inspection', 'Demonstration observation records minor seepage near the pump fitting.', now() - interval '5 hours', now() - interval '5 hours', '1', 'fictional-demo-only', repeat('2',64), 'Fictional demonstration inspection record.'),
        ('d0000000-0000-4000-8000-000000000503', demo_org, 'demo', 'demo://release/previous-repair', 'return_to_service', '[DEMO] Previous Hydraulic Repair Release', 'Demonstration return-to-service record approved by a fictional inspector.', now() - interval '44 days', now() - interval '44 days', '1', 'fictional-demo-only', repeat('3',64), 'Fictional demonstration release record.'),
        ('d0000000-0000-4000-8000-000000000504', demo_org, 'demo', 'demo://manual/cabin-filter/21-50', 'manual_excerpt', '[DEMO] Cabin Filter Replacement', 'Demonstration filter replacement interval and access instructions.', now() - interval '1 day', now() - interval '60 days', 'DEMO-1', 'fictional-demo-only', repeat('4',64), 'Fictional demonstration content. Not approved maintenance data.')
    ON CONFLICT (organization_id, content_hash) DO UPDATE SET
        title=EXCLUDED.title, excerpt=EXCLUDED.excerpt, retrieved_at=EXCLUDED.retrieved_at,
        content=EXCLUDED.content;

    INSERT INTO evidence_links (organization_id, evidence_id, case_id, aircraft_id, document_id) VALUES
        (demo_org, 'd0000000-0000-4000-8000-000000000501', 'd0000000-0000-4000-8000-000000000101', 'MXG-DEMO-N350MX', 'd0000000-0000-4000-8000-000000000401'),
        (demo_org, 'd0000000-0000-4000-8000-000000000502', 'd0000000-0000-4000-8000-000000000101', 'MXG-DEMO-N350MX', NULL),
        (demo_org, 'd0000000-0000-4000-8000-000000000503', 'd0000000-0000-4000-8000-000000000102', 'MXG-DEMO-N350MX', NULL),
        (demo_org, 'd0000000-0000-4000-8000-000000000504', 'd0000000-0000-4000-8000-000000000103', 'MXG-DEMO-N350MX', 'd0000000-0000-4000-8000-000000000401')
    ON CONFLICT DO NOTHING;

    INSERT INTO approvals (id, organization_id, case_id, action, required_role, granted_by, granted_at, decision) VALUES
        ('d0000000-0000-4000-8000-000000000521', demo_org, 'd0000000-0000-4000-8000-000000000102', 'return_to_service_review', 'quality', demo_actor, now() - interval '44 days 18 hours', 'approved'),
        ('d0000000-0000-4000-8000-000000000522', demo_org, 'd0000000-0000-4000-8000-000000000101', 'parts_release', 'quality', NULL, NULL, NULL)
    ON CONFLICT (id) DO UPDATE SET granted_by=EXCLUDED.granted_by, granted_at=EXCLUDED.granted_at, decision=EXCLUDED.decision;

    INSERT INTO parts (id, part_number, description, manufacturer, canonical, classification, is_serialized, metadata, updated_at) VALUES
        ('d0000000-0000-4000-8000-000000000601', 'MXG-DEMO-29-1001', '[DEMO] Hydraulic pump assembly', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"29"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000602', 'MXG-DEMO-21-2200', '[DEMO] Cabin air filter element', 'MXG Demo Components', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"21"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000603', 'MXG-DEMO-MS-O-RING', '[DEMO] Hydraulic fitting O-ring', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"29"}'::jsonb, now())
    ON CONFLICT (part_number, manufacturer) DO UPDATE SET
        description=EXCLUDED.description, classification=EXCLUDED.classification,
        is_serialized=EXCLUDED.is_serialized, metadata=EXCLUDED.metadata, updated_at=now();

    -- Challenger 350 wheel and brake hardware for the demo scenario, plus a
    -- realistic spread across other ATA chapters. Part numbers are
    -- deliberately synthetic so none can be mistaken for real OEM data.
    INSERT INTO parts (id, part_number, description, manufacturer, canonical, classification, is_serialized, metadata, updated_at) VALUES
        ('d0000000-0000-4000-8000-000000000701', 'MXG-DEMO-32-1101', '[DEMO] Main wheel assembly, outboard half', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000702', 'MXG-DEMO-32-1102', '[DEMO] Main wheel assembly, inboard half', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000703', 'MXG-DEMO-32-1103', '[DEMO] Nose wheel assembly', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000704', 'MXG-DEMO-32-1201', '[DEMO] Main brake assembly', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000705', 'MXG-DEMO-32-1202', '[DEMO] Brake lining set, main', 'MXG Demo Components', true, 'repairable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000706', 'MXG-DEMO-32-1203', '[DEMO] Brake rotor disc', 'MXG Demo Components', true, 'repairable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000707', 'MXG-DEMO-32-1204', '[DEMO] Brake stator disc', 'MXG Demo Components', true, 'repairable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000708', 'MXG-DEMO-32-1205', '[DEMO] Brake pressure plate', 'MXG Demo Components', true, 'repairable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000709', 'MXG-DEMO-32-1301', '[DEMO] Main tire, radial', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000710', 'MXG-DEMO-32-1302', '[DEMO] Nose tire, radial', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000711', 'MXG-DEMO-32-1401', '[DEMO] Wheel bearing cone, inboard', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000712', 'MXG-DEMO-32-1402', '[DEMO] Wheel bearing cone, outboard', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000713', 'MXG-DEMO-32-1403', '[DEMO] Wheel bearing cup', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000714', 'MXG-DEMO-32-1404', '[DEMO] Grease seal, wheel hub', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000715', 'MXG-DEMO-32-1501', '[DEMO] Wheel tie bolt', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000716', 'MXG-DEMO-32-1502', '[DEMO] Wheel tie bolt nut', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000717', 'MXG-DEMO-32-1503', '[DEMO] Axle nut, main gear', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000718', 'MXG-DEMO-32-1504', '[DEMO] Cotter pin, axle nut', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000719', 'MXG-DEMO-32-1601', '[DEMO] Thermal fuse plug', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000720', 'MXG-DEMO-32-1602', '[DEMO] Tire valve stem', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000721', 'MXG-DEMO-32-1603', '[DEMO] Tire valve core', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000722', 'MXG-DEMO-32-1701', '[DEMO] Wheel hub cap', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000723', 'MXG-DEMO-32-1702', '[DEMO] Torque plate, brake', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000724', 'MXG-DEMO-32-1801', '[DEMO] Shimmy damper assembly', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000725', 'MXG-DEMO-32-1802', '[DEMO] Gear door seal', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000726', 'MXG-DEMO-32-1901', '[DEMO] Wheel speed transducer', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000727', 'MXG-DEMO-32-1902', '[DEMO] Anti-skid harness, main gear', 'MXG Demo Components', true, 'repairable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000731', 'MXG-DEMO-29-1002', '[DEMO] Hydraulic filter element, return', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"29","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000732', 'MXG-DEMO-29-1003', '[DEMO] Hydraulic reservoir sight glass', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"29","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000733', 'MXG-DEMO-24-3001', '[DEMO] Generator control unit', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"24","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000734', 'MXG-DEMO-27-4001', '[DEMO] Flight control cable turnbuckle', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"27","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000735', 'MXG-DEMO-33-5001', '[DEMO] Landing light assembly', 'MXG Demo Components', true, 'repairable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"33","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000736', 'MXG-DEMO-34-6001', '[DEMO] Pitot probe, captain side', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"34","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000737', 'MXG-DEMO-79-7001', '[DEMO] Engine oil filter element', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"79","aircraft_type":"Challenger 350"}'::jsonb, now())
    ON CONFLICT (part_number, manufacturer) DO UPDATE SET
        description=EXCLUDED.description, classification=EXCLUDED.classification,
        is_serialized=EXCLUDED.is_serialized, metadata=EXCLUDED.metadata, updated_at=now();

    INSERT INTO part_requirements (
        id, organization_id, case_id, part_id, quantity, required_by,
        acceptable_conditions, status, priority, created_by
    ) VALUES
        ('d0000000-0000-4000-8000-000000000611', demo_org, 'd0000000-0000-4000-8000-000000000101', 'd0000000-0000-4000-8000-000000000601', 1, now() + interval '8 hours', '["NE","NS","OH"]'::jsonb, 'requested', 'aog', demo_actor),
        ('d0000000-0000-4000-8000-000000000612', demo_org, 'd0000000-0000-4000-8000-000000000101', 'd0000000-0000-4000-8000-000000000603', 2, now() + interval '8 hours', '["NE","NS"]'::jsonb, 'sourced', 'aog', demo_actor),
        ('d0000000-0000-4000-8000-000000000613', demo_org, 'd0000000-0000-4000-8000-000000000103', 'd0000000-0000-4000-8000-000000000602', 1, now() + interval '2 days', '["NE"]'::jsonb, 'requested', 'scheduled_mx', demo_actor),
        -- Wheel R&R demand for the Challenger 350 scenario, including one
        -- already past its need-by so the overdue path has something to show.
        ('d0000000-0000-4000-8000-000000000614', demo_org, 'd0000000-0000-4000-8000-000000000101', 'd0000000-0000-4000-8000-000000000709', 2, now() - interval '2 days', '["NE"]'::jsonb, 'ordered', 'aog', demo_actor),
        ('d0000000-0000-4000-8000-000000000615', demo_org, 'd0000000-0000-4000-8000-000000000101', 'd0000000-0000-4000-8000-000000000705', 1, now() + interval '1 day', '["NE"]'::jsonb, 'requested', 'aog', demo_actor),
        ('d0000000-0000-4000-8000-000000000616', demo_org, 'd0000000-0000-4000-8000-000000000103', 'd0000000-0000-4000-8000-000000000719', 4, NULL, '["NE"]'::jsonb, 'requested', 'stock', demo_actor)
    ON CONFLICT (id) DO UPDATE SET
        organization_id=EXCLUDED.organization_id, quantity=EXCLUDED.quantity,
        required_by=EXCLUDED.required_by, status=EXCLUDED.status,
        priority=EXCLUDED.priority, created_by=EXCLUDED.created_by;

    INSERT INTO suppliers (id, name, source_reference) VALUES
        ('d0000000-0000-4000-8000-000000000621', 'MXG Demo Parts Exchange', 'demo://supplier/parts-exchange'),
        ('d0000000-0000-4000-8000-000000000622', 'MXG Demo OEM Distribution', 'demo://supplier/oem')
    ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, source_reference=EXCLUDED.source_reference;

    INSERT INTO part_source_options (id, part_requirement_id, supplier_id, price, eta, condition, certificate_state, metadata) VALUES
        ('d0000000-0000-4000-8000-000000000631', 'd0000000-0000-4000-8000-000000000611', 'd0000000-0000-4000-8000-000000000621', 18450.00, now() + interval '7 hours', 'OH', 'form_8130_available', '{"demo":true,"exchange_core_due_days":30}'::jsonb),
        ('d0000000-0000-4000-8000-000000000632', 'd0000000-0000-4000-8000-000000000613', 'd0000000-0000-4000-8000-000000000622', 285.00, now() + interval '1 day', 'NE', 'coc_available', '{"demo":true}'::jsonb)
    ON CONFLICT (id) DO UPDATE SET price=EXCLUDED.price, eta=EXCLUDED.eta, certificate_state=EXCLUDED.certificate_state;

    INSERT INTO certificate_records (id, case_id, part_id, certificate_type, document_reference, validated) VALUES
        ('d0000000-0000-4000-8000-000000000641', 'd0000000-0000-4000-8000-000000000101', 'd0000000-0000-4000-8000-000000000601', 'FAA 8130-3', 'demo://certificate/8130/MXG-001', true)
    ON CONFLICT (id) DO UPDATE SET validated=EXCLUDED.validated;

    INSERT INTO inventory_locations (id, organization_id, code, name, location_type, barcode, metadata, updated_at) VALUES
        ('d0000000-0000-4000-8000-000000000651', demo_org, 'DEMO-MAIN-A1', '[DEMO] Main Stock A1', 'stock', 'MXG-DEMO-LOC-A1', '{"dataset":"mxgenius_complete_demo","demo":true}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000652', demo_org, 'DEMO-QUAR', '[DEMO] Inspection Quarantine', 'quarantine', 'MXG-DEMO-LOC-Q', '{"dataset":"mxgenius_complete_demo","demo":true}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000653', demo_org, 'DEMO-SHIP', '[DEMO] Shipping Staging', 'shipping', 'MXG-DEMO-LOC-S', '{"dataset":"mxgenius_complete_demo","demo":true}'::jsonb, now())
    ON CONFLICT (organization_id, code) DO UPDATE SET name=EXCLUDED.name, metadata=EXCLUDED.metadata, updated_at=now();

    INSERT INTO stock_units (
        id, organization_id, part_id, serial_number, lot_number, quantity,
        condition_code, status, trace_type, certificate_number, location_id,
        owner_type, received_at, created_by, metadata, version, updated_at
    ) VALUES
        ('d0000000-0000-4000-8000-000000000661', demo_org, 'd0000000-0000-4000-8000-000000000601', 'DEMO-PUMP-0042', NULL, 1, 'OH', 'available', 'form_8130', 'DEMO-8130-0042', 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '12 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"tag_url":"https://mxgenius.io/parts/demo-pump-0042","ocr_fields":{"part_number":"MXG-DEMO-29-1001","serial_number":"DEMO-PUMP-0042","confidence":0.97}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000662', demo_org, 'd0000000-0000-4000-8000-000000000602', NULL, 'DEMO-FILTER-26A', 6, 'NE', 'available', 'coc', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '20 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"certificate_gap":true}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000663', demo_org, 'd0000000-0000-4000-8000-000000000603', NULL, 'DEMO-ORING-88', 24, 'NE', 'available', 'coc', 'DEMO-COC-0088', 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '30 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000664', demo_org, 'd0000000-0000-4000-8000-000000000601', 'DEMO-PUMP-0099', NULL, 1, 'US', 'quarantine', 'none', NULL, 'd0000000-0000-4000-8000-000000000652', 'customer', now() - interval '1 day', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"reason":"awaiting trace review"}'::jsonb, 1, now())
    ON CONFLICT (organization_id, id) DO UPDATE SET
        quantity=EXCLUDED.quantity, condition_code=EXCLUDED.condition_code,
        status=EXCLUDED.status, trace_type=EXCLUDED.trace_type,
        certificate_number=EXCLUDED.certificate_number,
        location_id=EXCLUDED.location_id, metadata=EXCLUDED.metadata,
        version=EXCLUDED.version, updated_at=now();

    -- On-hand stock for the Challenger 350 wheel and brake scenario, so the
    -- headset can find and check out real inventory during the demo.
    INSERT INTO stock_units (
        id, organization_id, part_id, serial_number, lot_number, quantity,
        condition_code, status, trace_type, certificate_number, location_id,
        owner_type, received_at, created_by, metadata, version, updated_at
    ) VALUES
        ('d0000000-0000-4000-8000-000000000801', demo_org, 'd0000000-0000-4000-8000-000000000701', 'DEMO-MW-0117', NULL, 1, 'OH', 'available', 'form_8130', 'DEMO-8130-1117', 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '30 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"serial_number":"DEMO-MW-0117","confidence":0.96}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000802', demo_org, 'd0000000-0000-4000-8000-000000000703', 'DEMO-NW-0042', NULL, 1, 'SV', 'available', 'form_8130', 'DEMO-8130-1042', 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '30 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"serial_number":"DEMO-NW-0042","confidence":0.96}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000803', demo_org, 'd0000000-0000-4000-8000-000000000704', 'DEMO-BRK-0231', NULL, 1, 'OH', 'available', 'dual_release', 'DEMO-DR-2231', 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '30 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"serial_number":"DEMO-BRK-0231","confidence":0.96}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000804', demo_org, 'd0000000-0000-4000-8000-000000000706', 'DEMO-ROT-0455', NULL, 1, 'SV', 'available', 'ata106', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '30 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"serial_number":"DEMO-ROT-0455","confidence":0.96}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000805', demo_org, 'd0000000-0000-4000-8000-000000000723', 'DEMO-TP-0088', NULL, 1, 'SV', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '30 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"serial_number":"DEMO-TP-0088","confidence":0.96}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000806', demo_org, 'd0000000-0000-4000-8000-000000000726', 'DEMO-WST-0310', NULL, 1, 'NE', 'available', 'form_8130', 'DEMO-8130-3310', 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '30 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"serial_number":"DEMO-WST-0310","confidence":0.96}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000807', demo_org, 'd0000000-0000-4000-8000-000000000733', 'DEMO-GCU-0007', NULL, 1, 'OH', 'available', 'easa_form1', 'DEMO-EF1-0007', 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '30 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"serial_number":"DEMO-GCU-0007","confidence":0.96}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000808', demo_org, 'd0000000-0000-4000-8000-000000000736', 'DEMO-PITOT-0021', NULL, 1, 'NE', 'available', 'form_8130', 'DEMO-8130-0021', 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '30 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"serial_number":"DEMO-PITOT-0021","confidence":0.96}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000821', demo_org, 'd0000000-0000-4000-8000-000000000705', NULL, 'LOT-BL-7741', 4, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-BL-7741","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000822', demo_org, 'd0000000-0000-4000-8000-000000000709', NULL, 'LOT-TIRE-2210', 3, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-TIRE-2210","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000823', demo_org, 'd0000000-0000-4000-8000-000000000710', NULL, 'LOT-TIRE-2211', 2, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-TIRE-2211","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000824', demo_org, 'd0000000-0000-4000-8000-000000000711', NULL, 'LOT-BRG-5510', 8, 'NE', 'available', 'coc_vendor', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-BRG-5510","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000825', demo_org, 'd0000000-0000-4000-8000-000000000712', NULL, 'LOT-BRG-5511', 8, 'NE', 'available', 'coc_vendor', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-BRG-5511","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000826', demo_org, 'd0000000-0000-4000-8000-000000000714', NULL, 'LOT-SEAL-9902', 24, 'NE', 'available', 'coc_vendor', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-SEAL-9902","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000827', demo_org, 'd0000000-0000-4000-8000-000000000715', NULL, 'LOT-BOLT-3301', 40, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-BOLT-3301","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000828', demo_org, 'd0000000-0000-4000-8000-000000000716', NULL, 'LOT-NUT-3302', 40, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-NUT-3302","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000829', demo_org, 'd0000000-0000-4000-8000-000000000718', NULL, 'LOT-PIN-4400', 100, 'NE', 'available', 'coc_vendor', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-PIN-4400","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000830', demo_org, 'd0000000-0000-4000-8000-000000000719', NULL, 'LOT-FUSE-6620', 12, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-FUSE-6620","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000831', demo_org, 'd0000000-0000-4000-8000-000000000720', NULL, 'LOT-VLV-7730', 16, 'NE', 'available', 'coc_vendor', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-VLV-7730","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000832', demo_org, 'd0000000-0000-4000-8000-000000000721', NULL, 'LOT-VLC-7731', 30, 'NE', 'available', 'coc_vendor', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-VLC-7731","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000833', demo_org, 'd0000000-0000-4000-8000-000000000731', NULL, 'LOT-HYDF-8810', 6, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-HYDF-8810","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000834', demo_org, 'd0000000-0000-4000-8000-000000000737', NULL, 'LOT-OILF-9910', 10, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-OILF-9910","confidence":0.93}}'::jsonb, 1, now())
    ON CONFLICT (id) DO UPDATE SET
        quantity=EXCLUDED.quantity, condition_code=EXCLUDED.condition_code,
        status=EXCLUDED.status, trace_type=EXCLUDED.trace_type,
        metadata=EXCLUDED.metadata, updated_at=now();


    INSERT INTO receiving_drafts (
        id, organization_id, part_id, status, proposed_fields, created_by,
        expires_at, updated_at, version
    ) VALUES (
        'd0000000-0000-4000-8000-000000000671', demo_org,
        'd0000000-0000-4000-8000-000000000601', 'ready',
        '{"dataset":"mxgenius_complete_demo","demo":true,"part_number":"MXG-DEMO-29-1001","serial_number":"DEMO-PUMP-0100","condition_code":"OH","trace_type":"form_8130","location":"DEMO-QUAR"}'::jsonb,
        demo_actor, now() + interval '7 days', now(), 1
    ) ON CONFLICT (organization_id, id) DO UPDATE SET
        status=EXCLUDED.status, proposed_fields=EXCLUDED.proposed_fields,
        expires_at=EXCLUDED.expires_at, updated_at=now();

    INSERT INTO inventory_events (
        id, organization_id, stock_unit_id, event_type, quantity_delta,
        to_location_id, reference_type, reference_id, actor_user_id,
        correlation_id, notes, payload, created_at
    ) VALUES
        ('d0000000-0000-4000-8000-000000000681', demo_org, 'd0000000-0000-4000-8000-000000000661', 'receive', 1, 'd0000000-0000-4000-8000-000000000652', 'demo_receipt', 'DEMO-PO-1001', demo_actor, 'd0000000-0000-4000-8000-000000000689', '[DEMO] Pump received into quarantine.', '{"dataset":"mxgenius_complete_demo","demo":true}'::jsonb, now() - interval '12 days'),
        ('d0000000-0000-4000-8000-000000000682', demo_org, 'd0000000-0000-4000-8000-000000000661', 'inspect_pass', 0, 'd0000000-0000-4000-8000-000000000651', 'demo_inspection', 'DEMO-INSP-1001', demo_actor, 'd0000000-0000-4000-8000-000000000688', '[DEMO] Trace and condition inspection passed.', '{"dataset":"mxgenius_complete_demo","demo":true}'::jsonb, now() - interval '11 days')
    ON CONFLICT (organization_id, id) DO NOTHING;

    INSERT INTO faa_candidate_queries (
        id, organization_id, stock_unit_id, state, source_name, source_url,
        normalized_identifiers, candidates, retrieved_at, correlation_id
    ) VALUES (
        'd0000000-0000-4000-8000-000000000691', demo_org,
        'd0000000-0000-4000-8000-000000000661', 'candidates_found',
        'FAA DRS demonstration result', 'https://drs.faa.gov/browse/AD',
        '{"part_number":"MXG-DEMO-29-1001","manufacturer":"MXG Demo Components","demo":true}'::jsonb,
        '[{"reference":"DEMO-AD-2026-01","title":"DEMO ONLY — fictional hydraulic pump inspection","candidate_only":true}]'::jsonb,
        now(), 'd0000000-0000-4000-8000-000000000699'
    ) ON CONFLICT (organization_id, id) DO UPDATE SET
        state=EXCLUDED.state, candidates=EXCLUDED.candidates, retrieved_at=now();

    INSERT INTO schedule_options (id, case_id, start_at, end_at, notes) VALUES
        ('d0000000-0000-4000-8000-000000000721', 'd0000000-0000-4000-8000-000000000101', now() + interval '8 hours', now() + interval '20 hours', '[DEMO] Primary plan after pump delivery and trace review.'),
        ('d0000000-0000-4000-8000-000000000722', 'd0000000-0000-4000-8000-000000000103', now() + interval '2 days', now() + interval '2 days 4 hours', '[DEMO] Cabin filter replacement window.')
    ON CONFLICT (id) DO UPDATE SET start_at=EXCLUDED.start_at, end_at=EXCLUDED.end_at, notes=EXCLUDED.notes;

    INSERT INTO recommendations (id, case_id, body) VALUES
        ('d0000000-0000-4000-8000-000000000731', 'd0000000-0000-4000-8000-000000000101', '{"dataset":"mxgenius_complete_demo","demo":true,"recommendation":"Use the on-hand overhauled pump after quality verifies its demonstration trace record.","advisory_only":true}'::jsonb)
    ON CONFLICT (id) DO UPDATE SET body=EXCLUDED.body;

    INSERT INTO digital_twin_markers (
        id, organization_id, case_id, component_id, zone_id, severity,
        observation_id, created_by, created_at
    ) VALUES
        ('d0000000-0000-4000-8000-000000000801', demo_org, 'd0000000-0000-4000-8000-000000000101', 'MXG-DEMO-HYD-PUMP-B', 'right_aft_equipment_bay', 'high', 'd0000000-0000-4000-8000-000000000221', demo_actor, now() - interval '6 hours'),
        ('d0000000-0000-4000-8000-000000000802', demo_org, 'd0000000-0000-4000-8000-000000000103', 'MXG-DEMO-CABIN-FILTER', 'environmental_control_bay', 'low', 'd0000000-0000-4000-8000-000000000222', demo_actor, now() - interval '1 day')
    ON CONFLICT (id) DO UPDATE SET severity=EXCLUDED.severity, observation_id=EXCLUDED.observation_id;

    INSERT INTO audit_events (
        id, case_id, actor_user_id, organization_id, action, payload,
        correlation_id, created_at
    ) VALUES
        ('d0000000-0000-4000-8000-000000000901', 'd0000000-0000-4000-8000-000000000101', demo_actor, demo_org, 'demo.case.triaged', '{"dataset":"mxgenius_complete_demo","demo":true}'::jsonb, 'd0000000-0000-4000-8000-000000000909', now() - interval '7 hours'),
        ('d0000000-0000-4000-8000-000000000902', 'd0000000-0000-4000-8000-000000000102', demo_actor, demo_org, 'demo.return_to_service.reviewed', '{"dataset":"mxgenius_complete_demo","demo":true,"decision":"approved"}'::jsonb, 'd0000000-0000-4000-8000-000000000908', now() - interval '44 days 18 hours')
    ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload;
END $$;
