import { useRouter } from "next/router";
import { Menu, Transition } from "@headlessui/react";
import { Fragment, useEffect, useState } from "react";
import {
  HiMiniXMark,
  HiOutlineCalendarDays,
  HiOutlineIdentification,
  HiOutlineInboxStack,
} from "react-icons/hi2";

import Button from "~/components/Button";

const getSingleQueryValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const formatDateTimeLocal = (value: string | string[] | undefined) => {
  const raw = getSingleQueryValue(value);
  if (!raw) return "";

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";

  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

const toIso = (value: string) => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

export const hasActiveTicketFilters = (
  query: Record<string, string | string[] | undefined>,
) => {
  const values = [
    query.supportUserId,
    query.sourceSystem,
    query.sourceChannel,
    query.reportedFrom,
    query.reportedTo,
    query.updatedFrom,
    query.updatedTo,
  ];

  return values.some((value) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value),
  );
};

export function TicketFilters({ isLoading }: { isLoading: boolean }) {
  const router = useRouter();

  const hasActiveFilters = hasActiveTicketFilters(router.query);

  return (
    <Menu as="div" className="relative inline-block text-left">
      <Menu.Button as="div" className="cursor-pointer">
        <Button
          type="button"
          variant={hasActiveFilters ? "primary" : "secondary"}
          disabled={isLoading}
          iconLeft={<HiOutlineIdentification />}
        >
          Tickets
        </Button>
      </Menu.Button>

      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="transform opacity-0 scale-95"
        enterTo="transform opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="transform opacity-100 scale-100"
        leaveTo="transform opacity-0 scale-95"
      >
        <Menu.Items className="absolute left-0 z-[100] mt-2 w-80 origin-top-left rounded-md border border-light-200 bg-white p-3 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none dark:border-dark-400 dark:bg-dark-300">
          <TicketFiltersContent />
        </Menu.Items>
      </Transition>
    </Menu>
  );
}

export function TicketFiltersContent() {
  const router = useRouter();
  const [supportUserId, setSupportUserId] = useState("");
  const [sourceSystem, setSourceSystem] = useState("");
  const [sourceChannel, setSourceChannel] = useState("");
  const [reportedFrom, setReportedFrom] = useState("");
  const [reportedTo, setReportedTo] = useState("");
  const [updatedFrom, setUpdatedFrom] = useState("");
  const [updatedTo, setUpdatedTo] = useState("");

  useEffect(() => {
    setSupportUserId(getSingleQueryValue(router.query.supportUserId) ?? "");
    setSourceSystem(getSingleQueryValue(router.query.sourceSystem) ?? "");
    setSourceChannel(getSingleQueryValue(router.query.sourceChannel) ?? "");
    setReportedFrom(formatDateTimeLocal(router.query.reportedFrom));
    setReportedTo(formatDateTimeLocal(router.query.reportedTo));
    setUpdatedFrom(formatDateTimeLocal(router.query.updatedFrom));
    setUpdatedTo(formatDateTimeLocal(router.query.updatedTo));
  }, [
    router.query.reportedFrom,
    router.query.reportedTo,
    router.query.sourceChannel,
    router.query.sourceSystem,
    router.query.supportUserId,
    router.query.updatedFrom,
    router.query.updatedTo,
  ]);

  const applyFilters = async () => {
    const nextQuery = {
      ...router.query,
      supportUserId: supportUserId.trim() || undefined,
      sourceSystem: sourceSystem.trim() || undefined,
      sourceChannel: sourceChannel.trim() || undefined,
      reportedFrom: toIso(reportedFrom),
      reportedTo: toIso(reportedTo),
      updatedFrom: toIso(updatedFrom),
      updatedTo: toIso(updatedTo),
    };

    await router.push({ pathname: router.pathname, query: nextQuery });
  };

  const clearFilters = async () => {
    const nextQuery = { ...router.query };
    delete nextQuery.supportUserId;
    delete nextQuery.sourceSystem;
    delete nextQuery.sourceChannel;
    delete nextQuery.reportedFrom;
    delete nextQuery.reportedTo;
    delete nextQuery.updatedFrom;
    delete nextQuery.updatedTo;

    await router.push({ pathname: router.pathname, query: nextQuery });
  };

  const hasActiveFilters = hasActiveTicketFilters(router.query);

  return (
    <div className="space-y-3">
      <label className="block text-xs font-medium text-dark-900">
        User ID
        <input
          value={supportUserId}
          onChange={(event) => setSupportUserId(event.target.value)}
          className="mt-1 w-full rounded border border-light-300 bg-white px-2 py-1.5 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-light-700 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-1000"
        />
      </label>

      <div>
        <div className="mb-1 flex items-center gap-1 text-xs font-medium text-dark-900">
          <HiOutlineInboxStack className="h-4 w-4" />
          Source
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            value={sourceSystem}
            onChange={(event) => setSourceSystem(event.target.value)}
            placeholder="system"
            className="min-w-0 rounded border border-light-300 bg-white px-2 py-1.5 text-xs text-neutral-900 focus:outline-none focus:ring-2 focus:ring-light-700 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-1000"
          />
          <input
            value={sourceChannel}
            onChange={(event) => setSourceChannel(event.target.value)}
            placeholder="channel"
            className="min-w-0 rounded border border-light-300 bg-white px-2 py-1.5 text-xs text-neutral-900 focus:outline-none focus:ring-2 focus:ring-light-700 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-1000"
          />
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center gap-1 text-xs font-medium text-dark-900">
          <HiOutlineCalendarDays className="h-4 w-4" />
          Reported
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="datetime-local"
            value={reportedFrom}
            onChange={(event) => setReportedFrom(event.target.value)}
            className="min-w-0 rounded border border-light-300 bg-white px-2 py-1.5 text-xs text-neutral-900 focus:outline-none focus:ring-2 focus:ring-light-700 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-1000"
          />
          <input
            type="datetime-local"
            value={reportedTo}
            onChange={(event) => setReportedTo(event.target.value)}
            className="min-w-0 rounded border border-light-300 bg-white px-2 py-1.5 text-xs text-neutral-900 focus:outline-none focus:ring-2 focus:ring-light-700 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-1000"
          />
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center gap-1 text-xs font-medium text-dark-900">
          <HiOutlineCalendarDays className="h-4 w-4" />
          Last updated
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="datetime-local"
            value={updatedFrom}
            onChange={(event) => setUpdatedFrom(event.target.value)}
            className="min-w-0 rounded border border-light-300 bg-white px-2 py-1.5 text-xs text-neutral-900 focus:outline-none focus:ring-2 focus:ring-light-700 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-1000"
          />
          <input
            type="datetime-local"
            value={updatedTo}
            onChange={(event) => setUpdatedTo(event.target.value)}
            className="min-w-0 rounded border border-light-300 bg-white px-2 py-1.5 text-xs text-neutral-900 focus:outline-none focus:ring-2 focus:ring-light-700 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-1000"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={!hasActiveFilters}
          onClick={clearFilters}
          className="flex items-center gap-1 rounded px-2 py-1.5 text-sm text-dark-900 hover:bg-light-200 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-dark-400"
        >
          <HiMiniXMark className="h-4 w-4" />
          Clear
        </button>
        <Button type="button" size="sm" onClick={applyFilters}>
          Apply
        </Button>
      </div>
    </div>
  );
}
